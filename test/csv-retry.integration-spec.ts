import { ImportWorkerService } from '../src/modules/imports/import-worker.service';
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

describe('CSV batch rollback and retry against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => resetImports(fixture));
  afterEach(async () => {
    await fixture.service.pool.query(
      'DROP TRIGGER IF EXISTS csv_fault ON workout_sets; DROP FUNCTION IF EXISTS csv_fault(); DROP SEQUENCE IF EXISTS csv_attempts',
    );
  });
  afterAll(async () => fixture?.close());

  async function installFailure(transient: boolean, always = false) {
    await fixture.service.pool.query(`CREATE SEQUENCE csv_attempts;
      CREATE FUNCTION csv_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.position = 3 AND EXISTS (SELECT 1 FROM workout_entries e WHERE e.id=NEW.entry_id AND e.performed_at='2026-01-01T01:40:00Z') THEN
          IF nextval('csv_attempts') ${always ? '> 0' : '= 1'} THEN
            RAISE EXCEPTION 'private SQL failure' USING ERRCODE='${transient ? '40001' : '23514'}';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER csv_fault BEFORE INSERT ON workout_sets FOR EACH ROW EXECUTE FUNCTION csv_fault();`);
  }
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

  it('rolls back a partially inserted batch and retries it without duplicates', async () => {
    await installFailure(true);
    const response = await uploadCsv(fixture, csvFile(201)).expect(202);
    const job = await processJob(response.body.data.id);
    expect(job).toMatchObject({
      status: 'completed',
      processedEntries: 201,
      processedSets: 603,
      completedBatches: 3,
      retryCount: 1,
      attempts: 0,
    });
    expect(await fixture.counts()).toEqual({
      entries: 201,
      sets: 603,
      requests: 0,
    });
    const duplicates = await fixture.service.pool.query(
      'SELECT performed_at FROM workout_entries GROUP BY performed_at HAVING count(*)<>1',
    );
    expect(duplicates.rowCount).toBe(0);
    expect(
      (
        await fixture.service.pool.query(
          'SELECT last_value::int FROM csv_attempts',
        )
      ).rows[0].last_value,
    ).toBe(2);
  });

  it('does not retry a permanent record failure; prior committed batch remains visible', async () => {
    await installFailure(false);
    const response = await uploadCsv(fixture, csvFile(201)).expect(202);
    const job = await processJob(response.body.data.id);
    expect(job).toMatchObject({
      status: 'failed',
      processedEntries: 100,
      processedSets: 300,
      completedBatches: 1,
      retryCount: 0,
    });
    expect(job.error).toEqual({
      code: 'IMPORT_FAILED',
      record: null,
      field: null,
      message: 'Workout import failed',
    });
    expect(await fixture.counts()).toEqual({
      entries: 100,
      sets: 300,
      requests: 0,
    });
    expect(
      (
        await fixture.service.pool.query(
          'SELECT last_value::int FROM csv_attempts',
        )
      ).rows[0].last_value,
    ).toBe(1);
  });

  it('stops after three transient attempts with no partial failed batch', async () => {
    await installFailure(true, true);
    const response = await uploadCsv(fixture, csvFile(201)).expect(202);
    expect(await processJob(response.body.data.id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      retryCount: 2,
      processedEntries: 100,
      completedBatches: 1,
    });
    expect(await fixture.counts()).toEqual({
      entries: 100,
      sets: 300,
      requests: 0,
    });
    expect(
      (
        await fixture.service.pool.query(
          'SELECT last_value::int FROM csv_attempts',
        )
      ).rows[0].last_value,
    ).toBe(3);
  });
});
