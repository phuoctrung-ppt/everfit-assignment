import assert from 'node:assert/strict';
import { bulkBody, PRIMARY_USER, Workload } from './workload';
import { createRetryTransport } from './retry-transport';
import { installRecordFailure } from './record-failure';
import type { createPerformanceDatabase } from './database-fixture';

type Database = Awaited<ReturnType<typeof createPerformanceDatabase>>;
export interface BatchRetryProgress {
  attempts: { batch: number; status: number; responseHeadersMs: number }[];
  recovery: Record<string, unknown>[];
  batchLatenciesMs: number[];
}
export const BATCH_USER = PRIMARY_USER;
export const batchKey = (index: number) => `retained-batch-${index + 1}`;

export function batchBody(index: number, transientBatch: number) {
  const body = bulkBody(3, index);
  body.entries.forEach((entry, offset) => {
    entry.date = new Date(
      Date.UTC(2026, 0, 1) + (index * 100 + offset) * 60000,
    ).toISOString();
  });
  if (index === transientBatch) body.entries[49]!.sets[1]!.reps = 9999;
  return body;
}

export async function runBatchRetryWorkload(
  url: string,
  database: Database,
  batchCount: number,
  signal?: AbortSignal,
  progress: BatchRetryProgress = {
    attempts: [],
    recovery: [],
    batchLatenciesMs: [],
  },
) {
  assert.ok(Number.isInteger(batchCount) && batchCount >= 3);
  const invalidBatch = Math.floor(batchCount / 3);
  const transientBatch = Math.floor((batchCount * 2) / 3);
  const { attempts, recovery, batchLatenciesMs: timings } = progress;
  let currentBatch = 0;
  let fault: Awaited<ReturnType<typeof installRecordFailure>> | undefined;
  const load = new Workload(
    url,
    signal,
    createRetryTransport({
      maxAttempts: 3,
      baseDelayMs: 100,
      transport: async (target, init) => {
        const started = performance.now();
        const response = await fetch(target, init);
        attempts.push({
          batch: currentBatch + 1,
          status: response.status,
          responseHeadersMs: performance.now() - started,
        });
        return response;
      },
      onRetry: async (event) => {
        assert.equal(
          currentBatch,
          transientBatch,
          'Unexpected transient failure',
        );
        assert.ok(fault);
        const observed = await fault.evidence();
        const before = currentBatch * 100;
        assert.equal(observed.attempts, 1);
        assert.equal(observed.entriesSeenBeforeRollback, before + 100);
        assert.ok(observed.setsSeenBeforeRollback > before * 3);
        recovery.push({
          kind: 'transient-rollback',
          batch: currentBatch + 1,
          record: 50,
          set: 2,
          ...event,
          ...observed,
          afterRollback: await database.verify(load.expected),
          persistenceAfterRollback: await database.verifyPersistence(
            load.persistence,
          ),
        });
      },
    }),
  );
  load.expected.set(BATCH_USER, { entries: 0, sets: 0, requests: 0 });
  let retryResponse: unknown;
  try {
    for (currentBatch = 0; currentBatch < batchCount; currentBatch++) {
      signal?.throwIfAborted();
      const body = batchBody(currentBatch, transientBatch);
      const key = batchKey(currentBatch);
      const batchStarted = performance.now();
      if (currentBatch === invalidBatch) {
        const invalid = structuredClone(body);
        invalid.entries[49]!.exerciseName = 'Unknown benchmark exercise';
        const failed = await load.post(key, invalid, 400);
        assert.deepEqual(
          (failed.json as { error: { details: unknown } }).error.details,
          [{ path: 'entries.49.exerciseName', message: 'Unknown exercise' }],
        );
        recovery.push({
          kind: 'validation-rejected',
          batch: currentBatch + 1,
          record: 50,
          status: 400,
          automaticRetry: false,
          afterRollback: await database.verify(load.expected),
          persistenceAfterRollback: await database.verifyPersistence(
            load.persistence,
          ),
        });
        // Explicit fixture correction, not an automatic repair of arbitrary input.
      }
      if (currentBatch === transientBatch)
        fault = await installRecordFailure(database.databaseUrl);
      const result = await load.post(key, body, 201, true);
      timings.push(performance.now() - batchStarted);
      if (currentBatch === invalidBatch) {
        recovery.push({
          kind: 'corrected-batch',
          batch: currentBatch + 1,
          status: 201,
          sameKey: true,
        });
      }
      if (currentBatch === transientBatch) {
        const observed = await fault!.evidence();
        assert.equal(observed.attempts, 2);
        recovery.push({
          kind: 'transient-recovered',
          batch: currentBatch + 1,
          status: 201,
          identicalPayloadAndKey: true,
          ...observed,
        });
        retryResponse = result.json;
        await fault!.close();
        fault = undefined;
      }
      if ((currentBatch + 1) % 100 === 0)
        console.log(`Committed ${(currentBatch + 1) * 100} entries`);
    }
    assert.equal(attempts.length, batchCount + 2);
    assert.equal(
      attempts.filter((attempt) => attempt.status === 400).length,
      1,
    );
    assert.equal(
      attempts.filter((attempt) => attempt.status === 503).length,
      1,
    );
    assert.equal(
      attempts.filter((attempt) => attempt.status === 201).length,
      batchCount,
    );
    return { load, attempts, recovery, timings, transientBatch, retryResponse };
  } finally {
    await fault?.close();
  }
}
