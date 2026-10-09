export interface Snapshot {
  memory: NodeJS.MemoryUsage;
  pool: { total: number; idle: number; waiting: number };
  resources: string[];
}
export interface WindowMetrics {
  cpuUserMs: number;
  cpuSystemMs: number;
  wallMs: number;
  oneCoreCpuPercent: number;
  eventLoopUtilization: number;
  eventLoopP95Ms: number;
  peak: NodeJS.MemoryUsage;
  maxRssKiB: number;
}
export const BUDGETS = {
  p95Ms: 1000,
  cpuMsPerRequest: 100,
  rssMiB: 512,
  retainedHeapGrowthMiB: 16,
  heapSlopeMiBPerWindow: 1,
};
export const mib = (bytes: number) => bytes / 1024 ** 2;
export function percentile(values: number[], fraction: number): number {
  if (!values.length) throw new Error('No latency samples');
  return [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * fraction) - 1)
  ]!;
}
export function memoryTrend(snapshots: Snapshot[]) {
  if (snapshots.length < 4)
    throw new Error('Need baseline and at least three windows');
  const values = snapshots.map((sample) => mib(sample.memory.heapUsed));
  const center = (values.length - 1) / 2;
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - center) * (value - average);
    denominator += (index - center) ** 2;
  });
  return {
    growthMiB: values.at(-1)! - values[0]!,
    slopeMiBPerWindow: numerator / denominator,
    heapMiB: values,
  };
}
export function windowFailures(
  name: string,
  latencies: number[],
  metrics: WindowMetrics,
  snapshot: Snapshot,
): string[] {
  const failures: string[] = [];
  if (percentile(latencies, 0.95) > BUDGETS.p95Ms)
    failures.push(`${name}: p95 latency budget exceeded`);
  if (
    (metrics.cpuUserMs + metrics.cpuSystemMs) / latencies.length >
    BUDGETS.cpuMsPerRequest
  )
    failures.push(`${name}: CPU/request budget exceeded`);
  if (mib(metrics.peak.rss) > BUDGETS.rssMiB)
    failures.push(`${name}: sampled RSS budget exceeded`);
  if (snapshot.pool.waiting || snapshot.pool.total !== snapshot.pool.idle)
    failures.push(`${name}: database clients not released`);
  return failures;
}
