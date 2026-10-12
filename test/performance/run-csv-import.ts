import { AssertionError } from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { createPerformanceDatabase } from './database-fixture';
import { createCsvPool, removeCsvFault } from './csv-database';
import { generateCsv } from './csv-workload';
import { runCsvBenchmark, type CsvProcesses } from './csv-benchmark';

async function main() {
  const { values } = parseArgs({
    options: {
      'retain-database': { type: 'boolean', default: false },
      output: { type: 'string' },
    },
  });
  const output =
    values.output ?? `artifacts/performance/csv-import-${Date.now()}.json`;
  const csvPath = `${output}.csv`;
  const retain = values['retain-database'];
  const failures: string[] = [];
  const report: Record<string, unknown> = {
    status: 'running',
    stage: 'setup',
    startedAt: new Date().toISOString(),
    failures,
    config: {
      entries: 50000,
      sets: 150000,
      entriesPerBatch: 100,
      batches: 500,
      faultEntryIndexZeroBased: 25000,
      retainDatabase: retain,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      cpu: cpus()[0]?.model,
      runnerPid: process.pid,
    },
    limitations: [
      'Local real multipart HTTP upload and separate API/worker processes; no production capacity claim.',
      'Worker CPU and RSS use Linux /proc; unavailable metrics remain null. PostgreSQL and runner are excluded.',
      'Completion/staging are observed by GET polling at 100ms intervals plus HTTP latency.',
      'Generated UUIDs/creation times are checked for integrity and replay stability; input fields use an independent exact SQL oracle.',
    ],
  };
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const processes: CsvProcesses = {};
  let database:
    Awaited<ReturnType<typeof createPerformanceDatabase>> | undefined;
  let pool: ReturnType<typeof createCsvPool> | undefined;
  try {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    database = await createPerformanceDatabase();
    report.databaseName = new URL(database.databaseUrl).pathname.slice(1);
    pool = createCsvPool(database.databaseUrl);
    pool.on('error', () => {
      failures.push('Verification pool connection failed');
      abort.abort();
    });
    report.stage = 'generate-file';
    report.csv = {
      path: csvPath,
      ...(await generateCsv(csvPath, abort.signal)),
    };
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    await runCsvBenchmark(
      database.databaseUrl,
      pool,
      csvPath,
      abort.signal,
      report,
      processes,
    );
    report.status = 'passed';
  } catch (error) {
    report.failure = {
      stage: report.stage,
      category:
        error instanceof AssertionError
          ? 'correctness-assertion'
          : 'runtime-or-connection',
      operator: error instanceof AssertionError ? error.operator : undefined,
    };
    // Raw database/HTTP errors can contain connection strings or source data.
    failures.push(
      `Failed during ${String(report.stage)}; incomplete verification`,
    );
    report.status = 'failed';
  } finally {
    try {
      if (processes.worker) {
        report.workerMetrics = processes.worker.snapshot();
        report.workerExit = await processes.worker.close();
      }
    } catch {
      failures.push('Worker cleanup did not exit 0');
    }
    try {
      await processes.api?.close();
    } catch {
      failures.push('API cleanup failed');
    }
    let faultRemoved = !pool;
    try {
      if (pool) await removeCsvFault(pool);
      faultRemoved = true;
    } catch {
      failures.push('Fault cleanup failed; refusing to retain database');
    }
    try {
      await pool?.end();
    } catch {
      failures.push('Verification pool cleanup failed');
    }
    try {
      await database?.close(retain && faultRemoved);
      report.databaseRetained = Boolean(database && retain && faultRemoved);
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
  console.error('CSV benchmark configuration/report failure');
  process.exitCode = 1;
});
