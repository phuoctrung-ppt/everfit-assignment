import { IdempotencyRepository } from '../src/modules/workouts/idempotency.repository';
import { WorkoutLoggingRepository } from '../src/modules/workouts/workout-logging.repository';
import {
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('logging failure recovery against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('rolls back a real first entry, its sets, and reservation after a later write fails', async () => {
    const repository = fixture.app.get(WorkoutLoggingRepository);
    const insert = repository.insertEntries.bind(repository);
    let writtenSetCount: unknown;
    const failure = jest
      .spyOn(repository, 'insertEntries')
      .mockImplementationOnce(async (client, userId, entries, exercises) => {
        await insert(client, userId, [entries[0]!], exercises);
        const written = await client.query(
          'SELECT count(*)::int AS count FROM workout_sets',
        );
        writtenSetCount = written.rows[0].count;
        await client.query('INSERT INTO workout_entries (id) VALUES ($1)', [
          'not-a-uuid',
        ]);
        throw new Error('Expected PostgreSQL write to fail');
      });
    try {
      const result = await postWorkout(
        fixture.app,
        'partial',
        { entries: [workout, workout] },
        'logging-user',
        true,
      ).expect(500);
      expect(writtenSetCount).toBe(2);
      expect(result.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(result.body)).not.toMatch(
        /uuid|INSERT|postgres|stack/,
      );
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
    } finally {
      failure.mockRestore();
    }
    await postWorkout(
      fixture.app,
      'partial',
      { entries: [workout, workout] },
      'logging-user',
      true,
    ).expect(201);
    expect(await fixture.counts()).toEqual({
      entries: 2,
      sets: 4,
      requests: 1,
    });
  });

  it('rolls back all workout rows if storing the replay response fails', async () => {
    const repository = fixture.app.get(IdempotencyRepository);
    let writtenEntryCount: unknown;
    const failure = jest
      .spyOn(repository, 'complete')
      .mockImplementationOnce(async (client) => {
        const rows = await client.query(
          'SELECT count(*)::int AS count FROM workout_entries',
        );
        writtenEntryCount = rows.rows[0].count;
        await client.query(
          'SELECT missing_response_column FROM idempotency_requests',
        );
      });
    try {
      await postWorkout(fixture.app, 'completion').expect(500);
      expect(writtenEntryCount).toBe(1);
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
    } finally {
      failure.mockRestore();
    }
    await postWorkout(fixture.app, 'completion').expect(201);
  });

  it('returns sanitized 503 for a competing reservation lock timeout and leaves the key retryable', async () => {
    const locker = await fixture.service.pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(
        'INSERT INTO idempotency_requests (user_id, key, fingerprint) VALUES ($1, $2, $3)',
        ['logging-user', 'locked', 'uncommitted'],
      );
      const response = await postWorkout(fixture.app, 'locked').expect(503);
      expect(response.body.error).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        details: [],
      });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    expect(await fixture.counts()).toEqual({
      entries: 0,
      sets: 0,
      requests: 0,
    });
    await postWorkout(fixture.app, 'locked').expect(201);
  });

  it('rolls back a reservation on a real statement timeout and succeeds on retry', async () => {
    const repository = fixture.app.get(WorkoutLoggingRepository);
    const failure = jest
      .spyOn(repository, 'insertEntries')
      .mockImplementationOnce(async (client) => {
        await client.query("SET LOCAL statement_timeout = '30ms'");
        await client.query('SELECT pg_sleep(0.2)');
        throw new Error('Expected PostgreSQL statement timeout');
      });
    try {
      const response = await postWorkout(
        fixture.app,
        'statement-timeout',
      ).expect(503);
      expect(response.body.error).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        details: [],
      });
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
    } finally {
      failure.mockRestore();
    }
    await postWorkout(fixture.app, 'statement-timeout').expect(201);
  });
});
