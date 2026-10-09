import {
  memoryTrend,
  percentile,
  windowFailures,
  type Snapshot,
  type WindowMetrics,
} from './metrics';

const snapshot = (heapMiB: number): Snapshot => ({
  memory: {
    rss: 100 * 1024 ** 2,
    heapUsed: heapMiB * 1024 ** 2,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
  },
  pool: { total: 4, idle: 4, waiting: 0 },
  resources: [],
});
const metrics: WindowMetrics = {
  cpuUserMs: 100,
  cpuSystemMs: 10,
  wallMs: 500,
  oneCoreCpuPercent: 22,
  eventLoopUtilization: 0.2,
  eventLoopP95Ms: 10,
  peak: snapshot(20).memory,
  maxRssKiB: 102400,
};
describe('bulk performance regression diagnostics', () => {
  it('uses nearest-rank percentiles without changing raw sample order', () => {
    const values = [100, 1, 2, 3];
    expect(percentile(values, 0.5)).toBe(2);
    expect(percentile(values, 0.95)).toBe(100);
    expect(values).toEqual([100, 1, 2, 3]);
  });
  it('distinguishes a flat retained heap from persistent linear growth', () => {
    expect(memoryTrend([20, 20.2, 19.8, 20].map(snapshot)).growthMiB).toBe(0);
    const trend = memoryTrend([20, 22, 24, 26].map(snapshot));
    expect(trend.growthMiB).toBe(6);
    expect(trend.slopeMiBPerWindow).toBe(2);
    expect(() => memoryTrend([snapshot(20)])).toThrow();
  });
  it('fails latency, CPU, memory and unreleased pool budgets instead of reporting a pass', () => {
    expect(windowFailures('ok', [100, 200], metrics, snapshot(20))).toEqual([]);
    const busy = snapshot(20);
    busy.pool.idle = 3;
    const high = {
      ...metrics,
      cpuUserMs: 1000,
      peak: { ...metrics.peak, rss: 600 * 1024 ** 2 },
    };
    expect(windowFailures('bad', [2000, 2000], high, busy)).toHaveLength(4);
  });
});
