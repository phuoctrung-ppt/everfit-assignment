import request from 'supertest';
import { WorkoutEntrySchema } from '../../src/schemas/workout-response.schema';
import type { CreateWorkoutDto } from '../../src/schemas/workout.schema';
import { postWorkout, workout, type WorkoutFixture } from './workout-fixtures';

export function getHistory(
  fixture: WorkoutFixture,
  query: Record<string, string | number | undefined> = {},
  userId = 'history-user',
) {
  return request(fixture.app.getHttpServer())
    .get(`/users/${userId}/workout-entries`)
    .query(query);
}

export async function logHistory(
  fixture: WorkoutFixture,
  key: string,
  overrides: Partial<CreateWorkoutDto> = {},
  userId = 'history-user',
) {
  const response = await postWorkout(
    fixture.app,
    key,
    { ...workout, ...overrides },
    userId,
  ).expect(201);
  return WorkoutEntrySchema.parse(response.body.data);
}

export function entryIds(body: { data: { id: string }[] }): string[] {
  return body.data.map((entry) => entry.id);
}

export const emptyHistory = {
  data: [],
  pagination: { nextCursor: null, hasMore: false },
  message: 'No workout entries found for the requested filters.',
};
