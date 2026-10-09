import type { ApiProcess } from './api-process';
import {
  percentile,
  windowFailures,
  type Snapshot,
  type WindowMetrics,
} from './metrics';
import { runRequests } from './workload';

export async function measure(
  api: ApiProcess,
  name: string,
  count: number,
  concurrency: number,
  work: (index: number) => Promise<{ elapsedMs: number }>,
) {
  await api.command('start');
  let latencies: number[];
  let metrics: WindowMetrics;
  try {
    latencies = await runRequests(count, concurrency, work);
  } finally {
    metrics = await api.command<WindowMetrics>('stop');
  }
  const snapshot = await api.command<Snapshot>('snapshot');
  const result = {
    name,
    count,
    concurrency,
    latenciesMs: latencies,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    requestsPerSecond: count / (metrics.wallMs / 1000),
    cpuMsPerRequest: (metrics.cpuUserMs + metrics.cpuSystemMs) / count,
    metrics,
    postGc: snapshot,
    failures: windowFailures(name, latencies, metrics, snapshot),
  };
  console.log(
    `${name}: p95=${result.p95Ms.toFixed(1)}ms CPU=${result.cpuMsPerRequest.toFixed(1)}ms/request`,
  );
  return result;
}
