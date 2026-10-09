const { setImmediate: settle } = require('node:timers/promises');
const { setInterval, clearInterval } = require('node:timers');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { createApplication } = require('../../dist/bootstrap');
const { DatabaseService } = require('../../dist/database/database.service');

// Test-only IPC instrumentation. No HTTP metrics/GC endpoint enters the application.
async function main() {
  if (!process.send || !globalThis.gc)
    throw new Error('IPC and exposed GC required');
  const app = await createApplication();
  await app.listen(0, '127.0.0.1');
  const pool = app.get(DatabaseService).pool;
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  let window;
  let sampler;
  let peak;
  const sample = () => {
    const memory = process.memoryUsage();
    for (const key of Object.keys(memory))
      peak[key] = Math.max(peak[key], memory[key]);
  };
  const snapshot = async () => {
    await settle();
    globalThis.gc();
    await settle();
    globalThis.gc();
    return {
      memory: process.memoryUsage(),
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
      resources: process.getActiveResourcesInfo(),
    };
  };
  process.on('disconnect', () => {
    clearInterval(sampler);
    void app.close().finally(() => process.exit(1));
  });
  process.on('message', (message) => {
    void (async () => {
      let data;
      if (message.command === 'snapshot') data = await snapshot();
      else if (message.command === 'start') {
        peak = process.memoryUsage();
        histogram.reset();
        histogram.enable();
        window = {
          cpu: process.cpuUsage(),
          time: performance.now(),
          elu: performance.eventLoopUtilization(),
        };
        sampler = setInterval(sample, 20);
        data = true;
      } else if (message.command === 'stop') {
        const cpu = process.cpuUsage(window.cpu);
        const wallMs = performance.now() - window.time;
        const elu = performance.eventLoopUtilization(window.elu);
        clearInterval(sampler);
        sample();
        histogram.disable();
        data = {
          cpuUserMs: cpu.user / 1000,
          cpuSystemMs: cpu.system / 1000,
          wallMs,
          oneCoreCpuPercent: (cpu.user + cpu.system) / (wallMs * 10),
          eventLoopUtilization: elu.utilization,
          eventLoopP95Ms: histogram.percentile(95) / 1e6,
          peak,
          maxRssKiB: process.resourceUsage().maxRSS,
        };
      } else if (message.command === 'close') {
        clearInterval(sampler);
        await app.close();
        process.send({ id: message.id, data: true }, () => process.exit(0));
        return;
      } else throw new Error('Unknown worker command');
      process.send({ id: message.id, data });
    })().catch(() => {
      process.send({
        id: message.id,
        error: 'API worker instrumentation failed',
      });
    });
  });
  process.send({ id: 0, data: { url: await app.getUrl(), pid: process.pid } });
}

main().catch(() => {
  if (process.send) process.send({ id: 0, error: 'API worker startup failed' });
  process.exitCode = 1;
});
