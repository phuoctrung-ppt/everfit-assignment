import { ImportWorkerService } from '../src/modules/imports/import-worker.service';
import { stageImport } from '../src/modules/imports/import-staging';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';
import {
  csvFile,
  resetImports,
  uploadCsv,
  waitImport,
} from './support/csv-import-fixtures';

describe('durable CSV worker against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => resetImports(fixture));
  afterAll(async () => fixture?.close());

  async function processJob(id: string) {
    const abort = new AbortController();
    const worker = fixture.app.get(ImportWorkerService).run(abort.signal);
    try {
      return await waitImport(fixture, id);
    } finally {
      abort.abort();
      await worker;
    }
  }

  it('writes entries and exact mixed-unit sets in bounded batches with atomic progress', async () => {
    const response = await uploadCsv(fixture, csvFile(101)).expect(202);
    const job = await processJob(response.body.data.id);
    expect(job).toMatchObject({
      status: 'completed',
      totalEntries: 101,
      processedEntries: 101,
      totalSets: 303,
      processedSets: 303,
      totalBatches: 2,
      completedBatches: 2,
      retryCount: 0,
    });
    expect(await fixture.counts()).toEqual({
      entries: 101,
      sets: 303,
      requests: 0,
    });
    const invalid = await fixture.service.pool
      .query(`SELECT count(*)::int AS count FROM workout_sets s JOIN workout_entries e ON e.id=s.entry_id
      WHERE e.user_id <> 'csv-user' OR e.exercise_id <> '10000000-0000-4000-8000-000000000001'
      OR s.reps <> s.position+4 OR (s.position=1 AND (s.original_weight<>135 OR s.original_unit<>'lb' OR s.weight_kg<>61.23496995))
      OR (s.position>1 AND (s.original_weight<>0 OR s.original_unit<>'kg' OR s.weight_kg<>0))`);
    expect(invalid.rows[0].count).toBe(0);
    const clean = await fixture.service.pool.query(
      'SELECT source,(SELECT count(*)::int FROM workout_import_batches) AS staged FROM workout_imports WHERE id=$1',
      [job.id],
    );
    expect(clean.rows[0]).toEqual({ source: null, staged: 0 });
    const replay = await uploadCsv(fixture, csvFile(101)).expect(202);
    expect(replay.body.data.id).toBe(job.id);
    expect(replay.body.data.status).toBe('completed');
    expect((await fixture.counts()).entries).toBe(101);
  });

  it('also splits at 1000 sets without splitting an entry', async () => {
    const response = await uploadCsv(fixture, csvFile(11, 100)).expect(202);
    expect(await processJob(response.body.data.id)).toMatchObject({
      status: 'completed',
      totalEntries: 11,
      processedSets: 1100,
      totalBatches: 2,
    });
  });

  it.each([
    [
      'invalid value',
      'last,2026-01-01T00:00:00Z,Bench Press,1,0,10,kg',
      'CSV_INVALID_VALUE',
    ],
    [
      'unknown exercise',
      'last,2026-01-01T00:00:00Z,Secret Missing Exercise,1,5,10,kg',
      'CSV_UNKNOWN_EXERCISE',
    ],
  ])(
    'validates the entire file before writes: %s in final record',
    async (_, last, code) => {
      const file = Buffer.concat([csvFile(101), Buffer.from(last + '\n')]);
      const response = await uploadCsv(fixture, file).expect(202);
      const job = await processJob(response.body.data.id);
      expect(job).toMatchObject({
        status: 'failed',
        processedEntries: 0,
        error: { code, record: 304 },
      });
      expect(JSON.stringify(job.error)).not.toContain('Secret');
      expect(await fixture.counts()).toEqual({
        entries: 0,
        sets: 0,
        requests: 0,
      });
      expect(
        (
          await fixture.service.pool.query(
            'SELECT count(*)::int AS count FROM workout_import_batches',
          )
        ).rows[0].count,
      ).toBe(0);
      const fixed = await uploadCsv(
        fixture,
        csvFile(101),
        'corrected-file',
      ).expect(202);
      expect(await processJob(fixed.body.data.id)).toMatchObject({
        status: 'completed',
        processedEntries: 101,
      });
    },
  );

  it('rejects a second active worker and releases its lock on shutdown', async () => {
    const abort = new AbortController();
    const first = fixture.app.get(ImportWorkerService).run(abort.signal);
    try {
      // Wait until the first session owns the advisory lock.
      for (let attempt = 0; attempt < 100; attempt++) {
        const lock = await fixture.service.pool.query(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND classid=74321 AND objid=1 AND granted",
        );
        if (lock.rows[0].count) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await expect(fixture.app.get(ImportWorkerService).run()).rejects.toThrow(
        'already running',
      );
    } finally {
      abort.abort();
      await first;
    }
    const response = await uploadCsv(fixture).expect(202);
    expect((await processJob(response.body.data.id)).status).toBe('completed');
  });

  it('pins catalog identity at validation and rejects a subsequent rename', async () => {
    const response = await uploadCsv(fixture).expect(202);
    const id = response.body.data.id as string;
    await fixture.service.withTransaction((client) =>
      stageImport(client, id, csvFile()),
    );
    await fixture.service.pool.query(
      "UPDATE exercises SET name='Renamed Bench',normalized_name='renamed bench' WHERE normalized_name='bench press'",
    );
    try {
      const job = await processJob(id);
      expect(job).toMatchObject({
        status: 'failed',
        error: { code: 'IMPORT_CATALOG_CHANGED', record: 1 },
      });
      expect((await fixture.counts()).entries).toBe(0);
    } finally {
      await fixture.service.pool.query(
        "UPDATE exercises SET name='Bench Press',normalized_name='bench press' WHERE normalized_name='renamed bench'",
      );
    }
  });
});
