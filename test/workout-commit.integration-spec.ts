import {
  createWorkoutFixture,
  postWorkout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('workout transaction commit against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('returns failure and rolls back completed writes when a deferred check fails at COMMIT', async () => {
    await fixture.service.pool.query(`
      CREATE FUNCTION reject_test_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private commit failure'; END $$;
      CREATE CONSTRAINT TRIGGER reject_test_commit
        AFTER INSERT ON workout_entries DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION reject_test_commit();
    `);
    try {
      const result = await postWorkout(fixture.app, 'commit-failure').expect(
        500,
      );
      expect(result.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: [],
      });
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
    } finally {
      await fixture.service.pool.query(`
        DROP TRIGGER reject_test_commit ON workout_entries;
        DROP FUNCTION reject_test_commit();
      `);
    }
    await postWorkout(fixture.app, 'commit-failure').expect(201);
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 2,
      requests: 1,
    });
  });
  it('replays committed data when the first COMMIT acknowledgement is lost', async () => {
    const transaction = fixture.service.withTransaction.bind(fixture.service);
    const acknowledgement = jest
      .spyOn(fixture.service, 'withTransaction')
      .mockImplementationOnce(async (work) => {
        await transaction(work);
        throw Object.assign(new Error('Connection terminated unexpectedly'), {
          code: 'ECONNRESET',
        });
      });
    try {
      const failed = await postWorkout(fixture.app, 'uncertain-commit').expect(
        503,
      );
      expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(await fixture.counts()).toEqual({
        entries: 1,
        sets: 2,
        requests: 1,
      });
    } finally {
      acknowledgement.mockRestore();
    }
    const stored = await fixture.service.pool.query(
      'SELECT response_body FROM idempotency_requests WHERE user_id = $1 AND key = $2',
      ['logging-user', 'uncertain-commit'],
    );
    const retry = await postWorkout(fixture.app, 'uncertain-commit').expect(
      201,
    );
    expect(retry.body).toEqual(stored.rows[0].response_body);
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 2,
      requests: 1,
    });
  });
});
