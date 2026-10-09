import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { percentile } from './metrics';
import type { ReadScenario } from './read-scenarios';

export async function measureReads(
  url: string,
  scenario: ReadScenario,
  signal: AbortSignal,
) {
  const target = new URL(`/users/${scenario.userId}/${scenario.route}`, url);
  target.search = new URLSearchParams(scenario.query).toString();
  const work = async () => {
    const started = performance.now();
    const response = await fetch(target, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const body: unknown = await response.json();
    const elapsed = performance.now() - started;
    assert.equal(response.status, 200, `${scenario.name}: HTTP status`);
    assert.deepEqual(
      body,
      scenario.expected,
      `${scenario.name}: response correctness`,
    );
    return elapsed;
  };
  // A first-use observation, not an assertion that OS/PostgreSQL caches are cold.
  const firstObservationMs = await work();
  for (let i = 0; i < 10; i++) await work();
  const samplesMs = [];
  for (let i = 0; i < 100; i++) samplesMs.push(await work());
  const p95Ms = percentile(samplesMs, 0.95);
  return {
    scenario: scenario.name,
    route: scenario.route,
    query: scenario.query,
    firstObservationMs,
    warmups: 10,
    measuredRequests: 100,
    concurrency: 1,
    p50Ms: percentile(samplesMs, 0.5),
    p95Ms,
    targetMs: scenario.targetMs,
    targetPassed: p95Ms <= scenario.targetMs,
    failures: 0,
    correctResponses: 111,
    samplesMs,
  };
}
