import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { AssertionError } from 'node:assert';
import { startApiProcess, type ApiProcess } from './api-process';
import { createPerformanceDatabase } from './database-fixture';
import { BUDGETS, memoryTrend, type Snapshot } from './metrics';
import { measure } from './measure';
import { createScenarios } from './scenarios';
import { bulkBody, SECONDARY_USER, runRequests, Workload } from './workload';
import { EnvironmentSchema } from '../../src/schemas/environment.schema';

function integer(name: string, fallback: number, min: number, max: number) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || +value < min || +value > max)
    throw new Error(`Invalid ${name}`);
  return +value;
}
async function main() {
  const logLevel = EnvironmentSchema.shape.LOG_LEVEL.parse(
    process.env.PERF_LOG_LEVEL ?? 'info',
  );
  const rounds = integer('PERF_ROUNDS', 6, 6, 120);
  const requests = integer('PERF_REQUESTS', 100, 100, 1000);
  const entries = integer('PERF_ENTRIES', 51000, 51000, 1000000);
  if (entries % 100) throw new Error('PERF_ENTRIES must be a multiple of 100');
  const output =
    process.env.PERF_REPORT ?? `artifacts/performance/bulk-${Date.now()}.json`;
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let database:
    Awaited<ReturnType<typeof createPerformanceDatabase>> | undefined;
  let api: ApiProcess | undefined;
  const windows: Awaited<ReturnType<typeof measure>>[] = [];
  const failures: string[] = [];
  const report: Record<string, unknown> = {
    status: 'running',
    startedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length,
      availableParallelism: availableParallelism(),
      hostMemoryBytes: totalmem(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      workingTreeDirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim(),
      ),
      api: {
        nodeEnv: 'production',
        logLevel,
        heapLimitMiB: 512,
        poolMax: 10,
        statementTimeoutMs: 5000,
        lockTimeoutMs: 3000,
      },
    },
    config: {
      entries,
      setsPerSeedEntry: 3,
      secondaryEntries: 1000,
      warmups: 10,
      requests,
      rounds,
      soakRequestsPerWindow: 80,
    },
    budgets: BUDGETS,
    windows,
    failures,
    limitations: [
      'API process CPU/memory only; PostgreSQL and load generator excluded',
      'RSS peaks sampled every 20ms; maxRSS is lifetime high-water mark',
      'GC occurs outside timed windows; finite soak cannot prove absence of leaks',
      'Loopback closed-loop load, one API process; logging overhead included; no production SLO claim',
    ],
  };
  let stage = 'setup';
  try {
    database = await createPerformanceDatabase();
    api = await startApiProcess(database.databaseUrl, logLevel);
    console.log(
      `Benchmark backend: ${api.url} (PID ${api.pid}, LOG_LEVEL=${logLevel}); POST /users/:userId/workout-entries/bulk`,
    );
    const load = new Workload(api.url, abort.signal);
    stage = 'seed';
    console.log(`Loading ${entries} primary-user entries through bulk HTTP...`);
    await runRequests(entries / 100, 4, (index) =>
      load.post(`seed-${index}`, bulkBody(3, index), 201, true),
    );
    await runRequests(10, 4, (index) =>
      load.post(
        `secondary-${index}`,
        bulkBody(3, index),
        201,
        true,
        SECONDARY_USER,
      ),
    );
    report.seedCounts = await database.verify(load.expected);
    report.seedPersistence = await database.verifyPersistence(load.persistence);
    report.seedStorage = await database.details();
    await database.analyze();
    console.log(`Verified ${entries} primary entries and stored values.`);
    stage = 'first-max-batch';
    // First max-batch request after loading; caches are already warm, not a cold DB claim.
    report.firstMaxBatchMs = (
      await load.post('first-max', bulkBody(), 201, true)
    ).elapsedMs;
    const scenarios = await createScenarios(load);
    for (const scenario of scenarios) {
      stage = scenario.name;
      await runRequests(10, scenario.concurrency, (i) =>
        scenario.work(`${scenario.name}-warm-${i}`),
      );
      const result = await measure(
        api,
        scenario.name,
        requests,
        scenario.concurrency,
        (i) => scenario.work(`${scenario.name}-${i}`),
      );
      windows.push(result);
      failures.push(...result.failures);
      await database.verify(load.expected);
    }
    stage = 'soak-warmup';
    const mixed = [scenarios[1]!, scenarios[2]!, scenarios[3]!, scenarios[4]!];
    await runRequests(80, 4, (i) => mixed[i % 4]!.work(`soak-warm-${i}`));
    const snapshots = [await api.command<Snapshot>('snapshot')];
    for (let round = 0; round < rounds; round++) {
      stage = `soak-${round + 1}`;
      const result = await measure(api, stage, 80, 4, (i) =>
        mixed[i % 4]!.work(`soak-${round}-${i}`),
      );
      windows.push(result);
      failures.push(...result.failures);
      snapshots.push(result.postGc);
      await database.verify(load.expected);
    }
    const trend = memoryTrend(snapshots);
    report.memory = { snapshots, trend };
    if (trend.growthMiB > BUDGETS.retainedHeapGrowthMiB)
      failures.push('Retained heap growth budget exceeded');
    if (trend.slopeMiBPerWindow > BUDGETS.heapSlopeMiBPerWindow)
      failures.push('Retained heap slope budget exceeded');
    stage = 'retry-after-rollback';
    await load.post('reservation-rollback-c4-0', bulkBody(), 201, true);
    report.finalCounts = await database.verify(load.expected);
    report.finalPersistence = await database.verifyPersistence(
      load.persistence,
    );
    report.finalStorage = await database.details();
    report.status = failures.length ? 'failed' : 'passed';
  } catch (error) {
    report.failureCategory =
      error instanceof AssertionError
        ? 'correctness-assertion'
        : 'runtime-or-connection';
    failures.push(`Benchmark aborted during ${stage}; metrics incomplete`);
    report.status = 'failed';
  } finally {
    try {
      await api?.close();
    } catch {
      failures.push('API cleanup failed');
      report.status = 'failed';
    }
    try {
      await database?.close();
    } catch {
      failures.push('Isolated database cleanup failed');
      report.status = 'failed';
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    report.finishedAt = new Date().toISOString();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${output}; status=${String(report.status)}`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
void main().catch(() => {
  console.error('Performance runner configuration/startup failed');
  process.exitCode = 1;
});
