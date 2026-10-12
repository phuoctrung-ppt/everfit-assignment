import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { startApiProcess, type ApiProcess } from './api-process';
import {
  assertNoCsvWorkouts,
  csvFaultEvidence,
  installCsvFault,
  removeCsvFault,
  verifyCsvDatabase,
} from './csv-database';
import { startCsvWorker } from './csv-worker-process';
import { assertCompleted, awaitCsvCompletion, uploadCsv } from './csv-workload';

export interface CsvProcesses {
  api?: ApiProcess;
  worker?: ReturnType<typeof startCsvWorker>;
}

export async function runCsvBenchmark(
  databaseUrl: string,
  pool: Pool,
  csvPath: string,
  signal: AbortSignal,
  report: Record<string, unknown>,
  processes: CsvProcesses,
) {
  report.stage = 'api-start';
  signal.throwIfAborted();
  processes.api = await startApiProcess(databaseUrl, 'silent');
  assert.notEqual(processes.api.pid, process.pid);
  report.apiPid = processes.api.pid;
  report.stage = 'upload';
  const started = performance.now();
  const queued = await uploadCsv(processes.api.url, csvPath, signal);
  const uploadMs = performance.now() - started;
  report.upload = { durationMs: uploadMs, job: queued };
  assert.equal(queued.status, 'queued');
  assert.equal(queued.completedBatches, 0);
  assert.equal(queued.processedEntries, 0);
  assert.equal(queued.processedSets, 0);
  assert.equal(queued.retryCount, 0);
  report.stage = 'before-worker';
  report.beforeWorker = await assertNoCsvWorkouts(pool);
  await installCsvFault(pool);
  signal.throwIfAborted();
  report.stage = 'worker-staging-and-import';
  const workerStarted = performance.now();
  processes.worker = startCsvWorker(databaseUrl);
  assert.ok(processes.worker.pid);
  assert.notEqual(processes.worker.pid, processes.api.pid);
  assert.notEqual(processes.worker.pid, process.pid);
  report.workerPid = processes.worker.pid;
  let stagingObservedMs: number | null = null;
  const worker = processes.worker;
  const completed = await awaitCsvCompletion(
    processes.api.url,
    queued.id,
    signal,
    () => worker.check(),
    (job) => {
      report.lastObservedJob = job;
      if (stagingObservedMs === null && job.totalBatches === 500) {
        stagingObservedMs = performance.now() - workerStarted;
      }
    },
  );
  const finished = performance.now();
  const workerMs = finished - workerStarted;
  const totalMs = finished - started;
  report.durations = {
    uploadMs,
    workerStagingAndImportMs: workerMs,
    totalUploadThroughCompletionMs: totalMs,
    workerStartToStagedObservedMs: stagingObservedMs,
    scope:
      'Total starts before multipart upload, ends at completed GET; excludes generation, DB/API setup, verification and restart. Staging observation includes startup and polling delay.',
  };
  report.throughput = {
    workerEntriesPerSecond: (50000 * 1000) / workerMs,
    workerSetsPerSecond: (150000 * 1000) / workerMs,
    totalEntriesPerSecond: (50000 * 1000) / totalMs,
    totalSetsPerSecond: (150000 * 1000) / totalMs,
  };
  report.completedJob = completed;
  report.workerMetrics = worker.snapshot();
  report.workerExit = await worker.close();
  processes.worker = undefined;
  report.stage = 'retry-and-sql-verification';
  report.fault = await csvFaultEvidence(pool);
  await removeCsvFault(pool);
  const beforeReplay = await verifyCsvDatabase(pool);
  report.persistence = beforeReplay;
  signal.throwIfAborted();
  report.stage = 'api-restart-and-replay';
  const previousPid = processes.api.pid;
  await processes.api.close();
  processes.api = undefined;
  processes.api = await startApiProcess(databaseUrl, 'silent');
  assert.notEqual(processes.api.pid, previousPid);
  const replay = await uploadCsv(processes.api.url, csvPath, signal);
  assert.equal(replay.id, queued.id);
  assertCompleted(replay);
  assert.deepEqual(replay, completed, 'Replay changed the completed job');
  const afterReplay = await verifyCsvDatabase(pool);
  assert.deepEqual(
    afterReplay,
    beforeReplay,
    'Replay changed persisted rows or generated IDs',
  );
  report.restart = {
    previousPid,
    newPid: processes.api.pid,
    sameFileAndKey: true,
    sameJobId: replay.id,
    noReinsert: true,
    persistence: afterReplay,
  };
}
