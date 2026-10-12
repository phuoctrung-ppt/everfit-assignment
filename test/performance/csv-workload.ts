import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const CSV_USER = 'csv-benchmark';
export const CSV_KEY = 'csv-benchmark-50000-v1';
export interface CsvJob {
  id: string;
  userId: string;
  status: string;
  totalEntries: number;
  totalSets: number;
  totalBatches: number;
  completedBatches: number;
  processedEntries: number;
  processedSets: number;
  retryCount: number;
}

export async function generateCsv(path: string, signal: AbortSignal) {
  const file = await open(path, 'w');
  try {
    await file.writeFile(
      'entryRef,date,exerciseName,setPosition,reps,weight,unit\n',
    );
    for (let batch = 0; batch < 500; batch++) {
      signal.throwIfAborted();
      const lines: string[] = [];
      for (let offset = 0; offset < 100; offset++) {
        const index = batch * 100 + offset;
        const date = new Date(
          Date.UTC(2026, 0, 1) + index * 60000,
        ).toISOString();
        const prefix = `entry-${index},${date},Bench Press`;
        lines.push(
          `${prefix},1,5,135,lb`,
          `${prefix},2,6,60,kg`,
          `${prefix},3,7,0,kg`,
        );
      }
      await file.writeFile(lines.join('\n') + '\n');
    }
  } finally {
    await file.close();
  }
  const bytes = await readFile(path);
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function readJob(response: Response, expectedStatus: number) {
  assert.equal(response.status, expectedStatus, 'Unexpected CSV HTTP status');
  const body = (await response.json()) as { data: CsvJob };
  assert.ok(body.data && typeof body.data.id === 'string');
  assert.match(body.data.id, /^[a-f0-9-]{36}$/);
  assert.equal(body.data.userId, CSV_USER);
  for (const field of [
    'totalEntries',
    'totalSets',
    'totalBatches',
    'completedBatches',
    'processedEntries',
    'processedSets',
    'retryCount',
  ] as const) {
    assert.ok(
      Number.isSafeInteger(body.data[field]) && body.data[field] >= 0,
      field,
    );
  }
  return body.data;
}

export async function uploadCsv(
  url: string,
  path: string,
  signal: AbortSignal,
) {
  // Read the saved artifact again on replay; upload actual file bytes, never JSON.
  const bytes = new Uint8Array(await readFile(path));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'text/csv' }), basename(path));
  return readJob(
    await fetch(`${url}/users/${CSV_USER}/workout-entries/bulk/csv`, {
      method: 'POST',
      headers: { 'Idempotency-Key': CSV_KEY },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    }),
    202,
  );
}

export async function awaitCsvCompletion(
  url: string,
  id: string,
  signal: AbortSignal,
  checkWorker: () => void,
  progress: (job: CsvJob) => void,
) {
  const deadline = performance.now() + 600000;
  let completed = 0;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    checkWorker();
    const job = await readJob(
      await fetch(`${url}/users/${CSV_USER}/workout-entries/imports/${id}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      }),
      200,
    );
    assert.equal(job.id, id);
    assert.ok(
      job.completedBatches >= completed,
      'Committed progress regressed',
    );
    completed = job.completedBatches;
    progress(job);
    assert.notEqual(job.status, 'failed', 'CSV import failed');
    if (job.status === 'completed') {
      assertCompleted(job);
      return job;
    }
    await delay(100, undefined, { signal });
  }
  throw new Error('CSV import timed out');
}

export function assertCompleted(job: CsvJob) {
  assert.equal(job.status, 'completed');
  assert.equal(job.totalEntries, 50000);
  assert.equal(job.totalSets, 150000);
  assert.equal(job.totalBatches, 500);
  assert.equal(job.completedBatches, 500);
  assert.equal(job.processedEntries, 50000);
  assert.equal(job.processedSets, 150000);
  assert.equal(job.retryCount, 1);
}
