import request from 'supertest';
import { CSV_MAX_BYTES } from '../src/schemas/csv-import.schema';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';
import {
  csvFile,
  csvPath,
  readImport,
  resetImports,
  uploadCsv,
} from './support/csv-import-fixtures';

describe('CSV multipart upload against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => resetImports(fixture));
  afterAll(async () => fixture?.close());

  it('durably queues exact bytes without writing workouts and survives API restart', async () => {
    const file = csvFile(101);
    const response = await uploadCsv(fixture, file).expect(202);
    const id = response.body.data.id as string;
    expect(await readImport(fixture, id)).toMatchObject({
      status: 'queued',
      processedEntries: 0,
    });
    expect(await fixture.counts()).toEqual({
      entries: 0,
      sets: 0,
      requests: 0,
    });
    const stored = await fixture.service.pool.query(
      'SELECT source FROM workout_imports WHERE id=$1',
      [id],
    );
    expect(stored.rows[0].source).toEqual(file);
    await fixture.restart();
    const replay = await uploadCsv(fixture, file).expect(202);
    expect(replay.body.data.id).toBe(id);
    const result = await fixture.service.pool.query(
      'SELECT count(*)::int AS count FROM workout_imports',
    );
    expect(result.rows[0].count).toBe(1);
  });

  it('resolves concurrent duplicate uploads and rejects changed bytes', async () => {
    const [first, second] = await Promise.all([
      uploadCsv(fixture).expect(202),
      uploadCsv(fixture).expect(202),
    ]);
    expect(first.body.data.id).toBe(second.body.data.id);
    await uploadCsv(fixture, csvFile(2)).expect(409);
  });

  it('scopes status and retry keys by user', async () => {
    const first = await uploadCsv(fixture).expect(202);
    await request(fixture.app.getHttpServer())
      .get(`/users/other-user/workout-entries/imports/${first.body.data.id}`)
      .expect(404);
    const second = await request(fixture.app.getHttpServer())
      .post('/users/other-user/workout-entries/bulk/csv')
      .set('Idempotency-Key', 'csv-key')
      .attach('file', csvFile(), 'workouts.csv')
      .expect(202);
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });

  it('rejects missing/empty files, extra fields/files and malformed retry keys', async () => {
    const post = () =>
      request(fixture.app.getHttpServer())
        .post(`${csvPath}/bulk/csv`)
        .set('Idempotency-Key', 'key');
    await post().send({ entries: [] }).expect(400);
    await post().attach('file', Buffer.alloc(0), 'empty.csv').expect(400);
    await post().attach('wrong', csvFile(), 'wrong.csv').expect(400);
    await post()
      .field('userId', 'other')
      .attach('file', csvFile(), 'file.csv')
      .expect(400);
    await post()
      .attach('file', csvFile(), 'a.csv')
      .attach('file', csvFile(), 'b.csv')
      .expect(400);
    await request(fixture.app.getHttpServer())
      .post(`${csvPath}/bulk/csv`)
      .attach('file', csvFile(), 'file.csv')
      .expect(400);
    await uploadCsv(fixture, csvFile(), 'bad key').expect(400);
    expect(
      (
        await fixture.service.pool.query(
          'SELECT count(*)::int AS count FROM workout_imports',
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it('returns sanitized 503 for transient upload and status database failures', async () => {
    const uploaded = await uploadCsv(fixture).expect(202);
    const blocker = await fixture.service.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'LOCK TABLE workout_imports IN ACCESS EXCLUSIVE MODE',
      );
      const [upload, status] = await Promise.all([
        uploadCsv(fixture, csvFile(), 'locked-upload').expect(503),
        request(fixture.app.getHttpServer())
          .get(`${csvPath}/imports/${uploaded.body.data.id}`)
          .expect(503),
      ]);
      for (const response of [upload, status]) {
        expect(response.body.error).toEqual({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service unavailable',
          details: [],
        });
      }
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(
      (
        await fixture.service.pool.query(
          'SELECT count(*)::int AS count FROM workout_imports',
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('returns a CSV-specific 413 when the file exceeds 32 MiB', async () => {
    const response = await uploadCsv(
      fixture,
      Buffer.alloc(CSV_MAX_BYTES + 1, 'x'),
    ).expect(413);
    expect(response.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'CSV file exceeds 32 MiB',
    });
  });
});
