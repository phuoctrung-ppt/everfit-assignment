import request from 'supertest';
import {
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('workout HTTP validation against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('requires one bounded printable idempotency key before acquiring a transaction', async () => {
    const transaction = jest.spyOn(fixture.service, 'withTransaction');
    try {
      for (const key of [
        undefined,
        '',
        'contains space',
        'x'.repeat(129),
        ['one', 'two'],
      ]) {
        const pending = request(fixture.app.getHttpServer()).post(
          '/users/logging-user/workout-entries',
        );
        if (key !== undefined) pending.set({ 'Idempotency-Key': key });
        const result = await pending.send(workout).expect(400);
        expect(result.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
    expect(await fixture.counts()).toEqual({
      entries: 0,
      sets: 0,
      requests: 0,
    });
  });

  it('rejects invalid bodies, user identifiers, and excessive arrays before writes', async () => {
    const transaction = jest.spyOn(fixture.service, 'withTransaction');
    try {
      for (const body of [
        { ...workout, userId: 'forged-user' },
        { ...workout, date: '2026-02-30T00:00:00Z' },
        { ...workout, date: '2026-01-01T01:00:00+01:00' },
        { ...workout, exerciseName: 'Bench\u0000Press' },
        { ...workout, sets: [] },
        { ...workout, sets: Array(101).fill(workout.sets[0]) },
        ...[
          { reps: 1, weight: '135', unit: 'lb' },
          { reps: 1, weight: -1, unit: 'kg' },
          { reps: 1, weight: 0.0000001, unit: 'kg' },
          { reps: 0, weight: 1, unit: 'kg' },
          { reps: 1, weight: 1, unit: 'stone' },
          { reps: 1, weight: null, unit: 'kg' },
        ].map((set) => ({ ...workout, sets: [set] })),
      ]) {
        const result = await postWorkout(fixture.app, 'invalid', body).expect(
          400,
        );
        expect(result.body.error.code).toBe('VALIDATION_ERROR');
      }
      for (const userId of [
        'with%20space',
        'x'.repeat(129),
        'injection%27--',
      ]) {
        await postWorkout(fixture.app, 'invalid', workout, userId).expect(400);
      }
      for (const entries of [
        [],
        Array(101).fill(workout),
        Array(11).fill({ ...workout, sets: Array(100).fill(workout.sets[0]) }),
      ]) {
        await postWorkout(
          fixture.app,
          'invalid',
          { entries },
          'logging-user',
          true,
        ).expect(400);
      }
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
    expect(await fixture.counts()).toEqual({
      entries: 0,
      sets: 0,
      requests: 0,
    });
    await postWorkout(fixture.app, 'invalid').expect(201);
  });

  it('handles SQL punctuation in a valid key as data', async () => {
    const key = "';DROP_TABLE_workout_entries;--";
    const first = await postWorkout(fixture.app, key).expect(201);
    const replay = await postWorkout(fixture.app, key).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 2,
      requests: 1,
    });
  });

  it('accepts configured maximum batch, user, key, reps and weight boundaries', async () => {
    const entries = Array.from({ length: 100 }, () => ({
      ...workout,
      sets: Array.from({ length: 10 }, () => ({
        reps: 10000,
        weight: 1000000,
        unit: 'kg',
      })),
    }));
    const result = await postWorkout(
      fixture.app,
      'k'.repeat(128),
      { entries },
      'u'.repeat(128),
      true,
    ).expect(201);
    expect(result.body.data).toHaveLength(100);
    expect(result.body.data[0].sets[0].weight).toBe('1000000.0000');
    expect(await fixture.counts()).toEqual({
      entries: 100,
      sets: 1000,
      requests: 1,
    });
  });

  it('bounds JSON size before opening a transaction', async () => {
    const transaction = jest.spyOn(fixture.service, 'withTransaction');
    try {
      const result = await postWorkout(fixture.app, 'oversized', {
        ...workout,
        exerciseName: 'x'.repeat(1024 * 1024),
      }).expect(413);
      expect(result.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});
