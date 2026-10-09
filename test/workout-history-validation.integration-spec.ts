import request from 'supertest';
import { getHistory, logHistory } from './support/history-fixtures';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('workout history validation and failures against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: '01' },
    { limit: '1e1' },
    { limit: '' },
    { unit: 'stone' },
    { unknown: 'field' },
    { exerciseName: '' },
    { exerciseName: ' '.repeat(3) },
    { exerciseName: '\0' },
    { muscleGroup: '' },
    { muscleGroup: '\0' },
    { from: '2026-01-01' },
    { from: '2026-02-30T00:00:00Z' },
    { to: '2026-01-01T00:00:00+07:00' },
    { from: '2026-01-01T00:00:00.0001Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { cursor: 'not-base64?' },
    { cursor: '' },
    { cursor: 'a'.repeat(4097) },
    { cursor: Buffer.from('{}').toString('base64url') },
  ])(
    'rejects malformed query %j with sanitized structured errors',
    async (query) => {
      const response = await getHistory(fixture, query).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.length).toBeGreaterThan(0);
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
      expect(JSON.stringify(response.body)).not.toMatch(
        /SELECT|postgres|stack/,
      );
    },
  );

  it.each([
    'exerciseName',
    'muscleGroup',
    'from',
    'to',
    'unit',
    'limit',
    'cursor',
  ])('rejects duplicate %s parameters', async (field) => {
    const values: Record<string, string> = {
      exerciseName: 'bench',
      muscleGroup: 'chest',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      unit: 'kg',
      limit: '1',
      cursor: 'abc',
    };
    const query = new URLSearchParams([
      [field, values[field]!],
      [field, values[field]!],
    ]);
    const result = await request(fixture.app.getHttpServer())
      .get(`/users/history-user/workout-entries?${query}`)
      .expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['bad%20user', 'a'.repeat(129)])(
    'rejects invalid user path %s',
    async (user) => {
      const response = await getHistory(fixture, {}, user).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('sanitizes a real PostgreSQL lock timeout and recovers after release', async () => {
    const entry = await logHistory(fixture, 'locked');
    const locker = await fixture.service.pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('LOCK TABLE workout_entries IN ACCESS EXCLUSIVE MODE');
      const response = await getHistory(fixture).expect(503);
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
    const response = await getHistory(fixture).expect(200);
    expect(response.body.data[0].id).toBe(entry.id);
  });
});
