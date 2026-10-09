import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HistoryResponseSchema } from '../src/schemas/history-response.schema';
import {
  BulkWorkoutResponseSchema,
  SingleWorkoutResponseSchema,
} from '../src/schemas/workout-logging.schema';
import type { CreateWorkoutDto } from '../src/schemas/workout.schema';
import type { SmokeHttp } from './smoke-http';

export async function smokeWrites(http: SmokeHttp) {
  const user = `smoke-${randomUUID()}`;
  const path = `/users/${user}/workout-entries`;
  const key = randomUUID();
  const body: CreateWorkoutDto = {
    date: '2020-01-10T08:00:00Z',
    exerciseName: 'Bench Press',
    sets: [
      { reps: 8, weight: 60, unit: 'kg' },
      { reps: 5, weight: 100, unit: 'lb' },
    ],
  };
  const history = () => http.request(path, HistoryResponseSchema);
  http.stage = 'single mixed-unit logging and replay';
  const response = await http.request(
    path,
    SingleWorkoutResponseSchema,
    201,
    body,
    key,
  );
  assert.equal(response.data.userId, user);
  assert.equal(response.data.date, '2020-01-10T08:00:00.000Z');
  assert.equal(response.data.exercise.name, 'Bench Press');
  assert.deepEqual(
    response.data.sets.map(({ id, ...set }) => {
      assert(id);
      return set;
    }),
    [
      {
        position: 1,
        reps: 8,
        weight: '60.0000',
        unit: 'kg',
        originalWeight: '60.000000',
        originalUnit: 'kg',
      },
      {
        position: 2,
        reps: 5,
        weight: '45.3592',
        unit: 'kg',
        originalWeight: '100.000000',
        originalUnit: 'lb',
      },
    ],
  );
  assert.deepEqual(
    await http.request(path, SingleWorkoutResponseSchema, 201, body, key),
    response,
  );
  await http.error(path, 409, { ...body, date: '2020-01-11T08:00:00Z' }, key);
  await http.error(`${path}/bulk`, 409, { entries: [body] }, key);
  assert.equal((await history()).data.length, 1);

  http.stage = 'successful atomic bulk';
  const comparison = {
    ...body,
    date: '2020-02-10T08:00:00Z',
    sets: [{ reps: 8, weight: 70, unit: 'kg' }],
  };
  const zero = {
    date: '2020-02-15T08:00:00Z',
    exerciseName: 'Squat',
    sets: [{ reps: 10, weight: 0, unit: 'kg' }],
  };
  const bulkBody = { entries: [comparison, zero] };
  const bulkKey = randomUUID();
  const bulk = await http.request(
    `${path}/bulk`,
    BulkWorkoutResponseSchema,
    201,
    bulkBody,
    bulkKey,
  );
  assert.deepEqual(
    bulk.data.map((entry) => entry.exercise.name),
    ['Bench Press', 'Squat'],
  );
  assert.deepEqual(
    bulk.data.map((entry) => entry.sets[0]!.weight),
    ['70.0000', '0.0000'],
  );
  assert.deepEqual(
    await http.request(
      `${path}/bulk`,
      BulkWorkoutResponseSchema,
      201,
      bulkBody,
      bulkKey,
    ),
    bulk,
  );
  assert.equal((await history()).data.length, 3);

  http.stage = 'bulk rollback and idempotency key reuse';
  const failedKey = randomUUID();
  const before = await history();
  const failure = await http.error(
    `${path}/bulk`,
    400,
    {
      entries: [zero, { ...zero, exerciseName: `unknown-${randomUUID()}` }],
    },
    failedKey,
  );
  assert(
    failure.error.details.some(
      (detail) => detail.path === 'entries.1.exerciseName',
    ),
  );
  assert.deepEqual(await history(), before);
  const recovered = await http.request(
    `${path}/bulk`,
    BulkWorkoutResponseSchema,
    201,
    {
      entries: [
        { ...zero, date: '2020-03-10T08:00:00Z', exerciseName: 'Push Up' },
      ],
    },
    failedKey,
  );
  assert.equal(recovered.data[0]!.exercise.name, 'Push Up');
  assert.equal((await history()).data.length, 4);

  return { user, path, key, body, history, response, bulk, recovered };
}
