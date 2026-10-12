import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { smokeWrites } from './smoke-writes';
import { ExerciseListSchema } from '../src/schemas/exercise.schema';
import {
  EMPTY_HISTORY_MESSAGE,
  HistoryResponseSchema,
} from '../src/schemas/history-response.schema';
import { HealthResponseSchema } from '../src/schemas/http-response.schema';
import { SmokeHttp, smokeOptions } from './smoke-http';
import { smokeRecords } from './smoke-records';
import { smokeCsv } from './smoke-csv';
import { saveSmokeState, verifySmokeState } from './smoke-state';

async function run(http: SmokeHttp, options: ReturnType<typeof smokeOptions>) {
  http.stage = 'readiness';
  await http.request('/health', HealthResponseSchema);
  if (options.verifyState) {
    await verifySmokeState(http, options.verifyState, options.baseUrl);
    console.log(`PASS restart replay and history (${http.requests} requests)`);
    return;
  }
  http.stage = 'seeded catalog';
  const catalog = await http.request(
    '/exercises?limit=100',
    ExerciseListSchema,
  );
  for (const name of ['Bench Press', 'Squat', 'Deadlift', 'Push Up']) {
    assert(catalog.data.some((exercise) => exercise.name === name));
  }
  const chest = await http.request(
    '/exercises?muscleGroup=chest',
    ExerciseListSchema,
  );
  assert(chest.data.some((exercise) => exercise.name === 'Bench Press'));
  assert(
    chest.data.every((exercise) => exercise.muscleGroups.includes('chest')),
  );
  const { user, path, key, body, history, response, bulk, recovered } =
    await smokeWrites(http);
  http.stage = 'history filters, units, and pagination';
  const filters = new URLSearchParams({
    exerciseName: ' BeNcH ',
    muscleGroup: ' CHEST ',
    from: '2020-01-10T08:00:00Z',
    to: '2020-03-01T00:00:00Z',
    unit: 'lb',
    limit: '1',
  });
  const first = await http.request(`${path}?${filters}`, HistoryResponseSchema);
  assert.deepEqual(
    first.data.map((entry) => entry.id),
    [bulk.data[0]!.id],
  );
  assert.equal(first.data[0]!.sets[0]!.weight, '154.3236');
  assert.equal(first.message, null);
  assert(first.pagination.hasMore && first.pagination.nextCursor);
  filters.set('cursor', first.pagination.nextCursor);
  const second = await http.request(
    `${path}?${filters}`,
    HistoryResponseSchema,
  );
  assert.deepEqual(
    second.data.map((entry) => entry.id),
    [response.data.id],
  );
  assert.deepEqual(
    second.data[0]!.sets.map((set) => [
      set.weight,
      set.unit,
      set.originalWeight,
      set.originalUnit,
    ]),
    [
      ['132.2774', 'lb', '60.000000', 'kg'],
      ['100.0000', 'lb', '100.000000', 'lb'],
    ],
  );
  assert.deepEqual(second.pagination, { hasMore: false, nextCursor: null });
  filters.set('unit', 'kg');
  await http.error(`${path}?${filters}`, 400);
  const empty = await http.request(
    `${path}?from=2099-01-01T00:00:00Z`,
    HistoryResponseSchema,
  );
  assert.deepEqual(empty, {
    data: [],
    pagination: { nextCursor: null, hasMore: false },
    message: EMPTY_HISTORY_MESSAGE,
  });
  const boundary = await http.request(
    `${path}?to=2020-01-10T08:00:00Z`,
    HistoryResponseSchema,
  );
  assert.deepEqual(boundary, empty);
  await smokeRecords(http, user, response.data, bulk.data[0]!);

  http.stage = 'malformed requests';
  await http.error(
    path,
    400,
    { ...body, sets: [{ reps: 8, weight: '60', unit: 'kg' }] },
    randomUUID(),
  );
  await http.error(path, 400, body);
  for (const query of [
    'limit=0',
    'limit=1&limit=2',
    'cursor=invalid',
    'unit=stone',
    'from=2020-02-30T00:00:00Z',
  ]) {
    await http.error(`${path}?${query}`, 400);
  }
  const finalHistory = await history();
  assert.equal(finalHistory.data.length, 4);
  assert.deepEqual(
    new Set(finalHistory.data.map((entry) => entry.id)),
    new Set([
      response.data.id,
      ...bulk.data.map((entry) => entry.id),
      recovered.data[0]!.id,
    ]),
  );
  if (options.stateFile) {
    http.stage = 'save restart state';
    await saveSmokeState(options.stateFile, {
      baseUrl: options.baseUrl,
      user,
      key,
      body,
      response,
      history: finalHistory,
    });
  }
  await smokeCsv(http);
  console.log(
    `PASS catalog, writes, replay/conflict, rollback, history, records, validation, CSV imports (${http.requests} requests; 4 JSON and 2 CSV entries retained under separate users)`,
  );
}

let http: SmokeHttp | undefined;
void (async () => {
  const options = smokeOptions();
  http = new SmokeHttp(options);
  await run(http, options);
})().catch(() => {
  console.error(
    `FAIL smoke during ${http?.stage ?? 'configuration'}; response bodies, URLs, and keys suppressed`,
  );
  process.exitCode = 1;
});
