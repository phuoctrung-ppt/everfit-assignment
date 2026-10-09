import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { getHistory } from './support/history-fixtures';
import { comparisonQuery, getRecords } from './support/record-fixtures';
import {
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('additional HTTP boundaries against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it.each(['non-ascii-\u00e9', 'utf8-\u00c3\u00a9', 'control\tkey'])(
    'rejects non-printable-ASCII idempotency key %j without reserving it',
    async (key) => {
      const result = await postWorkout(fixture.app, key).expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
    },
  );

  it('bounds decompressed JSON and leaves the rejected key reusable', async () => {
    await fixture.app.listen(0, '127.0.0.1');
    const pending = request(fixture.app.getHttpServer())
      .post('/users/logging-user/workout-entries')
      .set('Idempotency-Key', 'compressed')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip');
    // Write raw bytes: send(Buffer) with JSON content type serializes the buffer.
    pending.write(
      gzipSync(JSON.stringify({ padding: 'x'.repeat(1024 * 1024) })),
    );
    const result = await pending.expect(413);
    expect(result.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(result.body.requestId).toBe(result.headers['x-request-id']);
    expect(await fixture.counts()).toEqual({
      entries: 0,
      sets: 0,
      requests: 0,
    });
    await postWorkout(fixture.app, 'compressed').expect(201);
  });

  it.each([
    { ...workout, date: '2025-02-29T00:00:00Z' },
    { ...workout, date: '2026-04-31T00:00:00Z' },
    { ...workout, date: '2026-01-01T24:00:00Z' },
    { ...workout, date: '2026-01-01T00:00:60Z' },
    { ...workout, sets: [{ reps: 1, weight: 1000000.000001, unit: 'kg' }] },
    { ...workout, sets: [{ reps: 1, weight: 1.0000001, unit: 'lb' }] },
    { ...workout, sets: [{ reps: 10001, weight: 1, unit: 'kg' }] },
  ])(
    'rejects calendar and numeric boundary overflow %j atomically',
    async (body) => {
      const result = await postWorkout(fixture.app, 'boundary', body).expect(
        400,
      );
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
    },
  );

  it('rejects JSON numeric overflow and malformed JSON before persistence', async () => {
    for (const body of [
      '{"date":',
      JSON.stringify({
        ...workout,
        sets: [{ reps: 1, weight: 1, unit: 'kg' }],
      }).replace('"weight":1', '"weight":1e309'),
    ]) {
      const result = await request(fixture.app.getHttpServer())
        .post('/users/logging-user/workout-entries')
        .set('Idempotency-Key', 'raw-json')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
    }
    expect(await fixture.counts()).toEqual({
      entries: 0,
      sets: 0,
      requests: 0,
    });
  });

  it('validates tampered cursor tuples and isolates reads despite a valid foreign tuple', async () => {
    for (const [user, weight] of [
      ['Owner', 10],
      ['owner', 900],
    ] as const) {
      for (const date of ['2026-01-02T00:00:00Z', '2026-02-02T00:00:00Z']) {
        await postWorkout(
          fixture.app,
          date,
          {
            ...workout,
            date,
            sets: [{ reps: 1, weight, unit: 'kg' }],
          },
          user,
        ).expect(201);
      }
    }
    const first = await getHistory(fixture, { limit: 1 }, 'Owner').expect(200);
    const cursor = JSON.parse(
      Buffer.from(
        first.body.pagination.nextCursor as string,
        'base64url',
      ).toString('utf8'),
    ) as Record<string, unknown>;
    for (const change of [
      { version: 2 },
      { id: "';SELECT 1--" },
      { date: '2026-02-30T00:00:00Z' },
      { filterDigest: '0'.repeat(64) },
    ]) {
      const result = await getHistory(
        fixture,
        {
          cursor: Buffer.from(
            JSON.stringify({ ...cursor, ...change }),
          ).toString('base64url'),
        },
        'Owner',
      ).expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    }
    const foreign = await getHistory(fixture, {}, 'owner').expect(200);
    const forged = Buffer.from(
      JSON.stringify({
        ...cursor,
        date: '9999-01-01T00:00:00Z',
        id: foreign.body.data[0].id,
      }),
    ).toString('base64url');
    const history = await getHistory(
      fixture,
      { cursor: forged },
      'Owner',
    ).expect(200);
    expect(history.body.data).toHaveLength(2);
    for (const entry of history.body.data) expect(entry.userId).toBe('Owner');
    const records = await getRecords(fixture, {}, false, 'Owner').expect(200);
    expect(records.body.data.heaviestSet.value).toBe('10.0000');
    const comparison = await getRecords(
      fixture,
      comparisonQuery,
      true,
      'Owner',
    ).expect(200);
    expect(comparison.body.data.baseline.records.heaviestSet.value).toBe(
      '10.0000',
    );
    expect(comparison.body.data.comparison.records.heaviestSet.value).toBe(
      '10.0000',
    );
    expect(comparison.body.data.differences.heaviestSet.value).toBe('0.0000');
  });
});
