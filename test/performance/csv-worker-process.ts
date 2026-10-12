import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Spawn the executable directly: reported PID and /proc metrics belong to Node. */
export function startCsvWorker(databaseUrl: string) {
  const child = spawn(process.execPath, [resolve('dist/import-worker.js')], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      DB_POOL_MAX: '10',
      DB_STATEMENT_TIMEOUT_MS: '30000',
      DB_LOCK_TIMEOUT_MS: '3000',
    },
    stdio: 'ignore',
  });
  let spawnFailed = false;
  child.once('error', () => {
    spawnFailed = true;
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  let ticksPerSecond: number | null = null;
  try {
    const ticks = Number(
      execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }),
    );
    if (Number.isFinite(ticks) && ticks > 0) ticksPerSecond = ticks;
  } catch {
    /* CPU metrics are optional on systems without getconf/procfs. */
  }
  const started = performance.now();
  const metrics = {
    pid: child.pid,
    sampleIntervalMs: 100,
    samples: 0,
    ticksPerSecond,
    cpuUserMs: null as number | null,
    cpuSystemMs: null as number | null,
    sampledPeakRssKiB: null as number | null,
    observedHighWaterRssKiB: null as number | null,
    scope:
      'Worker process only; /proc lifetime CPU through final sample, RSS every 100ms. Excludes API, database, runner. Peaks between samples may be missed.',
  };
  const sample = () => {
    if (!child.pid) return;
    try {
      const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]);
      const highWater = Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1]);
      if (Number.isFinite(rss))
        metrics.sampledPeakRssKiB = Math.max(
          metrics.sampledPeakRssKiB ?? 0,
          rss,
        );
      if (Number.isFinite(highWater))
        metrics.observedHighWaterRssKiB = Math.max(
          metrics.observedHighWaterRssKiB ?? 0,
          highWater,
        );
      if (ticksPerSecond) {
        metrics.cpuUserMs = (Number(fields[11]) * 1000) / ticksPerSecond;
        metrics.cpuSystemMs = (Number(fields[12]) * 1000) / ticksPerSecond;
      }
      metrics.samples++;
    } catch {
      /* Process may have exited, or procfs may be unavailable. */
    }
  };
  sample();
  const timer = setInterval(sample, 100);
  timer.unref();
  return {
    pid: child.pid,
    check() {
      assert.ok(
        !spawnFailed && child.exitCode === null && child.signalCode === null,
        'Import worker exited before completion',
      );
    },
    snapshot() {
      sample();
      return { ...metrics, sampledWallMs: performance.now() - started };
    },
    async close() {
      clearInterval(timer);
      sample();
      if (!spawnFailed && child.exitCode === null && child.signalCode === null)
        child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        const outcome = await exited;
        assert.deepEqual(
          outcome,
          { code: 0, signal: null },
          'Worker must exit 0 on SIGTERM',
        );
        return outcome;
      } finally {
        clearTimeout(force);
      }
    },
  };
}
