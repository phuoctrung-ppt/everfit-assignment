import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  EMPTY_HISTORY_MESSAGE,
  HistoryResponseSchema,
} from '../src/schemas/history-response.schema';
import { WorkoutImportResponseSchema } from '../src/schemas/workout-import.schema';
import { smokeCsvHistory } from './smoke-csv-history';
import type { SmokeHttp } from './smoke-http';

const source = [
  'entryRef,date,exerciseName,setPosition,reps,weight,unit',
  'january,2020-01-10T08:00:00Z,Bench Press,1,8,60,kg',
  'february,2020-02-10T08:00:00Z,Bench Press,1,8,70,kg',
  '',
].join('\n');

function csvForm(csv: string) {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'workouts.csv');
  return form;
}

async function waitImport(
  http: SmokeHttp,
  path: string,
  id: string,
  expected: 'completed' | 'failed',
) {
  // The caller must already have started the separate import worker.
  const signal = AbortSignal.timeout(30000);
  http.stage = `CSV polling for ${expected} (30s deadline; requires a running import worker)`;
  while (true) {
    const { data } = await http.request(
      `${path}/imports/${id}`,
      WorkoutImportResponseSchema,
      200,
      undefined,
      undefined,
      signal,
    );
    assert.equal(data.id, id);
    if (data.status === 'completed' || data.status === 'failed') {
      http.stage = `CSV terminal status must be ${expected}`;
      assert.equal(data.status, expected);
      return data;
    }
    await delay(100, undefined, { signal });
  }
}

export async function smokeCsv(http: SmokeHttp) {
  const user = `smoke-csv-${randomUUID()}`;
  const path = `/users/${user}/workout-entries`;
  const upload = (csv: string, key: string) =>
    http.request(
      `${path}/bulk/csv`,
      WorkoutImportResponseSchema,
      202,
      csvForm(csv),
      key,
    );

  http.stage = 'CSV malformed final row upload';
  const invalid = await upload(
    source.replace(',8,70,', ',invalid,70,'),
    randomUUID(),
  );
  const failed = await waitImport(http, path, invalid.data.id, 'failed');
  http.stage = 'CSV malformed final row leaves zero workouts';
  assert.equal(failed.userId, user);
  assert.equal(failed.processedEntries, 0);
  assert.equal(failed.processedSets, 0);
  assert.equal(failed.completedBatches, 0);
  assert.deepEqual(failed.error, {
    code: 'CSV_INVALID_VALUE',
    record: 2,
    field: 'reps',
    message: 'Invalid workout CSV',
  });
  assert.deepEqual(await http.request(path, HistoryResponseSchema), {
    data: [],
    pagination: { nextCursor: null, hasMore: false },
    message: EMPTY_HISTORY_MESSAGE,
  });

  http.stage = 'CSV multipart upload and immediate replay';
  const key = randomUUID();
  const accepted = await upload(source, key);
  assert.equal(accepted.data.userId, user);
  assert.notEqual(accepted.data.id, invalid.data.id);
  const replay = await upload(source, key);
  // Progress can change between requests; only job identity is immutable.
  assert.equal(replay.data.id, accepted.data.id);
  const completed = await waitImport(http, path, accepted.data.id, 'completed');
  http.stage = 'CSV completed counts';
  assert.equal(completed.userId, user);
  assert.equal(completed.totalEntries, 2);
  assert.equal(completed.processedEntries, 2);
  assert.equal(completed.totalSets, 2);
  assert.equal(completed.processedSets, 2);
  assert.equal(completed.totalBatches, 1);
  assert.equal(completed.completedBatches, 1);
  assert.equal(completed.error, null);
  const history = await smokeCsvHistory(http, user);

  http.stage = 'CSV completed replay, conflict, and validation';
  const terminalReplay = await upload(source, key);
  assert.equal(terminalReplay.data.id, completed.id);
  assert.equal(terminalReplay.data.status, 'completed');
  await http.error(
    `${path}/bulk/csv`,
    409,
    csvForm(source.replace(',8,70,', ',8,71,')),
    key,
  );
  await http.error(
    `/users/smoke-other-${randomUUID()}/workout-entries/imports/${completed.id}`,
    404,
  );
  await http.error(`${path}/imports/invalid`, 400);
  await http.error(
    `${path}/bulk/csv`,
    400,
    new FormData(),
    randomUUID(),
    'empty',
  );
  http.stage = 'CSV replay and rejected requests leave history unchanged';
  assert.deepEqual(await http.request(path, HistoryResponseSchema), history);
}
