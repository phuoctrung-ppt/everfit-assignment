import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  IdempotencyKeySchema,
  UserIdSchema,
} from '../src/schemas/common.schema';
import { HistoryResponseSchema } from '../src/schemas/history-response.schema';
import { SingleWorkoutResponseSchema } from '../src/schemas/workout-logging.schema';
import { CreateWorkoutSchema } from '../src/schemas/workout.schema';
import type { SmokeHttp } from './smoke-http';

export const SmokeStateSchema = z.strictObject({
  baseUrl: z.url(),
  user: UserIdSchema,
  key: IdempotencyKeySchema,
  body: CreateWorkoutSchema,
  response: SingleWorkoutResponseSchema,
  history: HistoryResponseSchema,
});

export async function saveSmokeState(
  file: string,
  state: z.infer<typeof SmokeStateSchema>,
) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(SmokeStateSchema.parse(state), null, 2) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
}

export async function verifySmokeState(
  http: SmokeHttp,
  file: string,
  baseUrl: string,
) {
  http.stage = 'restart persistence';
  const state = SmokeStateSchema.parse(
    JSON.parse(await readFile(file, 'utf8')),
  );
  assert.equal(state.baseUrl, baseUrl);
  const path = `/users/${state.user}/workout-entries`;
  assert.deepEqual(
    await http.request(
      path,
      SingleWorkoutResponseSchema,
      201,
      state.body,
      state.key,
    ),
    state.response,
  );
  assert.deepEqual(
    await http.request(path, HistoryResponseSchema),
    state.history,
  );
}
