import { createApplication } from '../src/bootstrap';
import {
  benchId,
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('persistent idempotency against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it.each([false, true])(
    'replays status and JSON content without inserting rows (bulk=%s)',
    async (bulk) => {
      const body = bulk ? { entries: [workout, workout] } : workout;
      const first = await postWorkout(
        fixture.app,
        'replay',
        body,
        'logging-user',
        bulk,
      ).expect(201);
      const counts = await fixture.counts();
      const retry = await postWorkout(
        fixture.app,
        'replay',
        body,
        'logging-user',
        bulk,
      ).expect(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['x-request-id']).not.toBe(
        first.headers['x-request-id'],
      );
      expect(await fixture.counts()).toEqual(counts);
    },
  );

  it('ignores JSON object key ordering while preserving value differences', async () => {
    const first = await postWorkout(fixture.app, 'ordering').expect(201);
    const retry = await postWorkout(fixture.app, 'ordering', {
      sets: workout.sets.map(({ reps, weight, unit }) => ({
        unit,
        weight,
        reps,
      })),
      exerciseName: workout.exerciseName,
      date: workout.date,
    }).expect(201);
    expect(retry.body).toEqual(first.body);
    for (const changed of [
      { ...workout, exerciseName: 'Bench Press' },
      { ...workout, sets: [...workout.sets].reverse() },
      { ...workout, sets: [{ reps: 5, weight: 60, unit: 'kg' }] },
    ]) {
      const conflict = await postWorkout(
        fixture.app,
        'ordering',
        changed,
      ).expect(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 2,
      requests: 1,
    });
  });

  it('rejects reused keys across routes and permits the same key under another user', async () => {
    await postWorkout(fixture.app, 'scope').expect(201);
    const conflict = await postWorkout(
      fixture.app,
      'scope',
      { entries: [workout] },
      'logging-user',
      true,
    ).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const other = await postWorkout(
      fixture.app,
      'scope',
      workout,
      'Other-user',
    ).expect(201);
    expect(other.body.data.userId).toBe('Other-user');
    expect(await fixture.counts()).toEqual({
      entries: 2,
      sets: 4,
      requests: 2,
    });
  });

  it('replays the original response after app restart and catalog rename', async () => {
    const first = await postWorkout(fixture.app, 'restart').expect(201);
    await fixture.service.pool.query(
      'UPDATE exercises SET name = $1, normalized_name = $2 WHERE id = $3',
      ['Renamed Bench', 'renamed bench', benchId],
    );
    try {
      await fixture.restart();
      const replay = await postWorkout(fixture.app, 'restart').expect(201);
      expect(replay.body).toEqual(first.body);
      expect(await fixture.counts()).toEqual({
        entries: 1,
        sets: 2,
        requests: 1,
      });
    } finally {
      await fixture.service.pool.query(
        'UPDATE exercises SET name = $1, normalized_name = $2 WHERE id = $3',
        ['Bench Press', 'bench press', benchId],
      );
    }
  });

  it('concurrent matching keys across app instances persist one batch and return identical responses', async () => {
    const peer = await createApplication();
    try {
      await peer.init();
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          postWorkout(
            index % 2 ? peer : fixture.app,
            'concurrent',
            { entries: [workout, workout] },
            'logging-user',
            true,
          ).expect(201),
        ),
      );
      for (const response of responses)
        expect(response.body).toEqual(responses[0]!.body);
      expect(await fixture.counts()).toEqual({
        entries: 2,
        sets: 4,
        requests: 1,
      });
    } finally {
      await peer.close();
    }
  });

  it('concurrent different payloads sharing a key commit only one request', async () => {
    const responses = await Promise.all([
      postWorkout(fixture.app, 'competing', workout),
      postWorkout(fixture.app, 'competing', {
        ...workout,
        exerciseName: 'Squat',
      }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 2,
      requests: 1,
    });
  });

  it('concurrent distinct keys retain legitimate identical-time entries', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        postWorkout(fixture.app, `distinct-${index}`).expect(201),
      ),
    );
    expect(new Set(responses.map(({ body }) => body.data.id)).size).toBe(6);
    expect(await fixture.counts()).toEqual({
      entries: 6,
      sets: 12,
      requests: 6,
    });
  });
});
