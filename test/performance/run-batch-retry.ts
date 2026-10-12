import assert, { AssertionError } from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { cpus } from 'node:os';
import { createPerformanceDatabase } from './database-fixture';
import { startApiProcess, type ApiProcess } from './api-process';
import { Workload } from './workload';
import {
  BATCH_USER,
  batchBody,
  batchKey,
  runBatchRetryWorkload,
  type BatchRetryProgress,
} from './batch-retry-workload';
import {
  BUDGETS,
  mib,
  percentile,
  type Snapshot,
  type WindowMetrics,
} from './metrics';

async function main() {
  const { values } = parseArgs({
    options: {
      'retain-database': { type: 'boolean', default: false },
      output: { type: 'string' },
    },
  });
  const output =
    values.output ?? `artifacts/performance/batch-retry-${Date.now()}.json`;
  const retain = values['retain-database'];
  const failures: string[] = [];
  const progress: BatchRetryProgress = {
    attempts: [],
    recovery: [],
    batchLatenciesMs: [],
  };
  const report: Record<string, unknown> = {
    status: 'running',
    startedAt: new Date().toISOString(),
    config: {
      entries: 50000,
      setsPerEntry: 3,
      batches: 500,
      batchSize: 100,
      concurrency: 1,
      maxAttempts: 3,
      retryBaseDelayMs: 100,
      retainDatabase: retain,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      cpu: cpus()[0]?.model,
      runnerPid: process.pid,
    },
    failures,
    load: progress,
    budgets: {
      batchP95Ms: BUDGETS.p95Ms,
      apiCpuMsPerBatch: BUDGETS.cpuMsPerRequest,
      sampledApiRssMiB: BUDGETS.rssMiB,
    },
    limitations: [
      'Local loopback batch job including validation, fault injection and rollback checks; no production capacity claim',
      'SQL fault injection uses a test-only trigger; removed before retention',
      'API CPU/RSS exclude PostgreSQL and benchmark parent; no CSV upload or durable import queue',
    ],
  };
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let database:
    Awaited<ReturnType<typeof createPerformanceDatabase>> | undefined;
  let api: ApiProcess | undefined;
  let stage = 'setup';
  try {
    await mkdir(dirname(output), { recursive: true });
    database = await createPerformanceDatabase();
    report.databaseName = new URL(database.databaseUrl).pathname.slice(1);
    // Save discovery metadata immediately; never write credentials to artifacts.
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    api = await startApiProcess(database.databaseUrl, 'silent');
    assert.notEqual(api.pid, process.pid);
    report.apiPid = api.pid;
    console.log(
      `Runner PID=${process.pid}; API PID=${api.pid}; database=${String(report.databaseName)}`,
    );
    stage = 'batch-load-and-retry';
    await api.command('start');
    const started = performance.now();
    const result = await runBatchRetryWorkload(
      api.url,
      database,
      500,
      abort.signal,
      progress,
    );
    const elapsedMs = performance.now() - started;
    const metrics = await api.command<WindowMetrics>('stop');
    const idle = await api.command<Snapshot>('snapshot');
    assert.equal(idle.pool.waiting, 0);
    assert.equal(idle.pool.total, idle.pool.idle);
    report.load = {
      elapsedMs,
      entriesPerSecond: 50000 / (elapsedMs / 1000),
      batchP50Ms: percentile(result.timings, 0.5),
      batchP95Ms: percentile(result.timings, 0.95),
      sampledApiRssMiB: mib(metrics.peak.rss),
      apiCpuMs: metrics.cpuUserMs + metrics.cpuSystemMs,
      metrics,
      idle,
      batchLatenciesMs: result.timings,
      attempts: result.attempts,
      recovery: result.recovery,
    };
    if (percentile(result.timings, 0.95) > BUDGETS.p95Ms)
      failures.push('Batch p95 screening budget exceeded');
    if (
      (metrics.cpuUserMs + metrics.cpuSystemMs) / 500 >
      BUDGETS.cpuMsPerRequest
    )
      failures.push('API CPU/batch screening budget exceeded');
    if (mib(metrics.peak.rss) > BUDGETS.rssMiB)
      failures.push('API RSS screening budget exceeded');
    stage = 'verify-stored-content';
    const expected = { entries: 50000, sets: 150000, requests: 500 };
    assert.deepEqual(result.load.expected.get(BATCH_USER), expected);
    report.counts = await database.verify(result.load.expected);
    report.persistence = await database.verifyPersistence(
      result.load.persistence,
    );
    report.storage = await database.details();
    stage = 'restart-and-replay';
    const oldPid = api.pid;
    await api.close();
    api = undefined;
    report.afterApiStopped = await database.verify(result.load.expected);
    api = await startApiProcess(database.databaseUrl, 'silent');
    assert.notEqual(api.pid, oldPid);
    await new Workload(api.url, abort.signal).post(
      batchKey(result.transientBatch),
      batchBody(result.transientBatch, result.transientBatch),
      201,
      false,
      BATCH_USER,
      result.retryResponse,
    );
    report.restart = {
      previousPid: oldPid,
      newPid: api.pid,
      replayIdentical: true,
      counts: await database.verify(result.load.expected),
      persistence: await database.verifyPersistence(result.load.persistence),
    };
    report.status = 'passed';
  } catch (error) {
    report.failure = {
      stage,
      category:
        error instanceof AssertionError
          ? 'correctness-assertion'
          : 'runtime-or-connection',
      operator: error instanceof AssertionError ? error.operator : undefined,
    };
    failures.push(`Failed during ${stage}; incomplete verification`);
    report.status = 'failed';
  } finally {
    try {
      await api?.close();
    } catch {
      failures.push('API cleanup failed');
    }
    try {
      await database?.close(retain);
      report.databaseRetained = Boolean(database && retain);
    } catch {
      failures.push('Database cleanup failed');
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (failures.length) report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      `Report: ${output}; status=${String(report.status)}; retained=${String(report.databaseRetained)}`,
    );
  }
  if (failures.length) process.exitCode = 1;
}
void main().catch(() => {
  console.error('Batch benchmark configuration/report failure');
  process.exitCode = 1;
});
