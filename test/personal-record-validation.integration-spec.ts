import request from 'supertest';
import {
  comparisonQuery,
  getRecords,
  logRecord,
} from './support/record-fixtures';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('personal record validation and failures against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it.each([
    { exerciseName: undefined },
    { exerciseName: '' },
    { exerciseName: '  ' },
    { exerciseName: '\0' },
    { exerciseName: 'a'.repeat(201) },
    { unit: 'stone' },
    { limit: '20' },
    { cursor: 'abc' },
    { unknown: 'value' },
    { from: '2026-01-01' },
    { from: '2026-02-30T00:00:00Z' },
    { to: '2026-01-01T00:00:00+07:00' },
    { from: '2026-01-01T00:00:00.0001Z' },
    { from: '2026-02-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
    { from: '2026-03-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
  ])('rejects malformed standard query %j', async (query) => {
    const response = await getRecords(fixture, query).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it.each([
    { baselineFrom: undefined },
    { baselineTo: undefined },
    { comparisonFrom: undefined },
    { comparisonTo: undefined },
    { baselineFrom: comparisonQuery.baselineTo },
    { comparisonTo: comparisonQuery.comparisonFrom },
    { baselineFrom: comparisonQuery.comparisonTo },
    { comparisonTo: comparisonQuery.baselineFrom },
    { comparisonFrom: '2026-02-30T00:00:00Z' },
    { exerciseName: 'unknown' },
    { exerciseName: undefined },
    { unit: 'stone' },
    { from: comparisonQuery.baselineFrom },
  ])('rejects malformed comparison query %j', async (query) => {
    const response = await getRecords(
      fixture,
      { ...comparisonQuery, ...query },
      true,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });

  it.each([
    [false, 'exerciseName'],
    [false, 'unit'],
    [false, 'from'],
    [false, 'to'],
    [true, 'exerciseName'],
    [true, 'unit'],
    [true, 'baselineFrom'],
    [true, 'baselineTo'],
    [true, 'comparisonFrom'],
    [true, 'comparisonTo'],
  ] as const)(
    'rejects duplicate parameters (comparison=%s, %s)',
    async (compare, field) => {
      const values: Record<string, string> = {
        exerciseName: 'Bench Press',
        unit: 'kg',
        from: comparisonQuery.baselineFrom,
        to: comparisonQuery.baselineTo,
        ...comparisonQuery,
      };
      const query = new URLSearchParams(
        compare
          ? { exerciseName: 'Bench Press', ...comparisonQuery }
          : { exerciseName: 'Bench Press' },
      );
      query.set(field, values[field]!);
      query.append(field, values[field]!);
      const response = await request(fixture.app.getHttpServer())
        .get(
          `/users/records-user/personal-records${compare ? '/compare' : ''}?${query}`,
        )
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it.each([false, true])(
    'validates users and sanitizes real lock timeouts (comparison=%s)',
    async (compare) => {
      const query = compare ? comparisonQuery : {};
      for (const userId of ['bad%20user', 'a'.repeat(129)]) {
        const invalid = await getRecords(
          fixture,
          query,
          compare,
          userId,
        ).expect(400);
        expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
      }
      await logRecord(fixture, 'entry');
      const locker = await fixture.service.pool.connect();
      try {
        await locker.query('BEGIN');
        await locker.query(
          'LOCK TABLE workout_entries IN ACCESS EXCLUSIVE MODE',
        );
        const response = await getRecords(fixture, query, compare).expect(503);
        expect(response.body.error).toEqual({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service unavailable',
          details: [],
        });
        expect(JSON.stringify(response.body)).not.toMatch(
          /SELECT|postgres|stack|timeout/,
        );
      } finally {
        await locker.query('ROLLBACK');
        locker.release();
      }
      await getRecords(fixture, query, compare).expect(200);
    },
  );
});
