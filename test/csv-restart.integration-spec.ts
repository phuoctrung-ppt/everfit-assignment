import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';
import {
  csvFile,
  readImport,
  uploadCsv,
  waitImport,
} from './support/csv-import-fixtures';

describe('CSV import process crash recovery', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  afterAll(async () => fixture?.close());

  function startWorker(): ChildProcess {
    return fork(resolve('src/import-worker.ts'), [], {
      execArgv: ['-r', 'ts-node/register'],
      env: {
        ...process.env,
        DB_LOCK_TIMEOUT_MS: '20000',
        DB_STATEMENT_TIMEOUT_MS: '30000',
      },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
  }
  async function stop(child: ChildProcess, signal: NodeJS.Signals) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill(signal);
    await exited;
  }

  it('resumes from the committed batch after SIGKILL during the next transaction', async () => {
    const response = await uploadCsv(fixture, csvFile(201)).expect(202);
    const id = response.body.data.id as string;
    const blocker = await fixture.service.pool.connect();
    let worker: ChildProcess | undefined;
    try {
      await blocker.query('SELECT pg_advisory_lock(74322, 1)');
      await fixture.service.pool
        .query(`CREATE FUNCTION csv_pause() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.position=3 AND EXISTS (SELECT 1 FROM workout_entries e WHERE e.id=NEW.entry_id AND e.performed_at='2026-01-01T01:40:00Z') THEN
            PERFORM pg_advisory_xact_lock(74322,1);
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER csv_pause BEFORE INSERT ON workout_sets FOR EACH ROW EXECUTE FUNCTION csv_pause();`);
      worker = startWorker();
      let blocked = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const locks = await fixture.service.pool.query(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND classid=74322 AND objid=1 AND NOT granted",
        );
        if (locks.rows[0].count) {
          blocked = true;
          break;
        }
        if (worker.exitCode !== null)
          throw new Error('Worker exited before blocked transaction');
        await setTimeout(10);
      }
      expect(blocked).toBe(true);
      expect(await readImport(fixture, id)).toMatchObject({
        status: 'running',
        completedBatches: 1,
        processedEntries: 100,
      });
      expect(await fixture.counts()).toEqual({
        entries: 100,
        sets: 300,
        requests: 0,
      });
      const firstPid = worker.pid;
      await stop(worker, 'SIGKILL');
      worker = undefined;
      await blocker.query('SELECT pg_advisory_unlock(74322, 1)');
      worker = startWorker();
      expect(worker.pid).not.toBe(firstPid);
      expect(await waitImport(fixture, id)).toMatchObject({
        status: 'completed',
        completedBatches: 3,
        processedEntries: 201,
        processedSets: 603,
      });
      expect(await fixture.counts()).toEqual({
        entries: 201,
        sets: 603,
        requests: 0,
      });
      const duplicate = await fixture.service.pool.query(
        'SELECT performed_at FROM workout_entries GROUP BY performed_at HAVING count(*)<>1',
      );
      expect(duplicate.rowCount).toBe(0);
      await stop(worker, 'SIGTERM');
      expect(worker.exitCode).toBe(0);
      worker = undefined;
    } finally {
      if (worker) await stop(worker, 'SIGKILL');
      await blocker.query('SELECT pg_advisory_unlock_all()');
      blocker.release();
      await fixture.service.pool.query(
        'DROP TRIGGER IF EXISTS csv_pause ON workout_sets; DROP FUNCTION IF EXISTS csv_pause()',
      );
    }
  });
});
