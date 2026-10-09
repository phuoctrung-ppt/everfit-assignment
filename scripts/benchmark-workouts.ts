import { AssertionError } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cpus, availableParallelism, totalmem, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { datasetConfig } from '../test/performance/dataset-config';
import { buildReadDataset } from '../test/performance/read-dataset';
import { readScenarios } from '../test/performance/read-scenarios';
import { readQueryPlans } from '../test/performance/read-query-plans';
import { measureReads } from '../test/performance/read-measure';
import {
  startApiProcess,
  type ApiProcess,
} from '../test/performance/api-process';
import {
  createTestDatabase,
  type TestDatabase,
} from '../test/support/test-database';
import { runTestMigrations } from '../test/support/migrations';
import {
  performanceDatabase,
  seedPerformanceData,
  verifyReadCounts,
} from './seed-performance-data';

async function main() {
  const config = datasetConfig(process.argv.slice(2));
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let owned: TestDatabase | undefined;
  let database: ReturnType<typeof performanceDatabase> | undefined;
  let api: ApiProcess | undefined;
  let stage = 'setup';
  const scenarios: Awaited<ReturnType<typeof measureReads>>[] = [];
  const plans: Awaited<ReturnType<typeof readQueryPlans>>[] = [];
  const failures: string[] = [];
  const report: Record<string, unknown> = {
    status: 'running',
    startedAt: new Date().toISOString(),
    config: {
      entries: config.entries,
      setsPerEntry: config.setsPerEntry,
      secondaryEntries: 1000,
      seed: config.seed,
      warmups: 10,
      requests: 100,
      concurrency: 1,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      kernel: release(),
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
        logLevel: 'silent',
        poolMax: 10,
        heapLimitMiB: 512,
        statementTimeoutMs: 5000,
        lockTimeoutMs: 3000,
      },
    },
    scenarios,
    plansFile: `${config.output}.plans.json`,
    failures,
    limitations: [
      'Loopback, sequential closed-loop requests; no production capacity or concurrent-coach claim',
      'First observation per scenario is after loading/ANALYZE; shared caches are not forcibly cleared',
      'Latency includes HTTP transfer and JSON parsing; independent response assertions run after timing',
      'EXPLAIN runs after timing and may warm caches for subsequent scenarios',
    ],
  };
  try {
    if (!config.databaseUrl) owned = await createTestDatabase();
    const databaseUrl = config.databaseUrl ?? owned!.databaseUrl;
    if (config.databaseUrl) await runTestMigrations(databaseUrl);
    database = performanceDatabase(databaseUrl);
    const dataset = buildReadDataset(config);
    stage = 'load-and-count';
    report.counts = await seedPerformanceData(database, dataset);
    report.postgres = (
      await database.pool.query('SHOW server_version')
    ).rows[0].server_version;
    report.databaseSettings = (
      await database.pool.query(`SELECT name, setting, unit FROM pg_settings
      WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_connections','jit') ORDER BY name`)
    ).rows;
    console.log(
      `Verified ${config.entries} entries / ${config.entries * config.setsPerEntry} sets plus secondary user`,
    );
    api = await startApiProcess(databaseUrl, 'silent');
    for (const scenario of readScenarios(dataset)) {
      stage = scenario.name;
      const result = await measureReads(api.url, scenario, abort.signal);
      scenarios.push(result);
      if (!result.targetPassed)
        failures.push(
          `${scenario.name}: warm p95 exceeds ${scenario.targetMs}ms`,
        );
      console.log(
        `${scenario.name}: p50=${result.p50Ms.toFixed(2)}ms p95=${result.p95Ms.toFixed(2)}ms`,
      );
      plans.push(await readQueryPlans(database, scenario));
    }
    report.finalCounts = await verifyReadCounts(database, dataset);
    report.status = failures.length ? 'failed' : 'passed';
  } catch (error) {
    report.failureCategory =
      error instanceof AssertionError
        ? 'correctness-assertion'
        : 'runtime-or-connection';
    failures.push(`Benchmark aborted during ${stage}; measurements incomplete`);
    report.status = 'failed';
  } finally {
    for (const [name, close] of [
      ['API', () => api?.close()],
      ['pool', () => database?.onApplicationShutdown()],
      ['owned database', () => owned?.close()],
    ] as const) {
      try {
        await close();
      } catch {
        failures.push(`${name} cleanup failed`);
        report.status = 'failed';
      }
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    report.finishedAt = new Date().toISOString();
    await mkdir(dirname(config.output), { recursive: true });
    await writeFile(config.output, JSON.stringify(report, null, 2) + '\n');
    await writeFile(
      `${config.output}.plans.json`,
      JSON.stringify(plans, null, 2) + '\n',
    );
    console.log(`Report: ${config.output}; status=${String(report.status)}`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
void main().catch(() => {
  console.error('Invalid benchmark configuration or report destination');
  process.exitCode = 1;
});
