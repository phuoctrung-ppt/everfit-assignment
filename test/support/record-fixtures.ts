import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { CreateWorkoutDto } from '../../src/schemas/workout.schema';
import { logHistory } from './history-fixtures';
import { benchId, type WorkoutFixture } from './workout-fixtures';

export const recordMetrics = [
  'heaviestSet',
  'highestVolumeSet',
  'estimatedOneRepMax',
] as const;
export const emptyRecords = {
  heaviestSet: null,
  highestVolumeSet: null,
  estimatedOneRepMax: null,
};
export const emptyRecordMessage =
  'No workout entries found for the requested exercise and range.';
export const comparisonQuery = {
  baselineFrom: '2026-01-01T00:00:00Z',
  baselineTo: '2026-02-01T00:00:00Z',
  comparisonFrom: '2026-02-01T00:00:00Z',
  comparisonTo: '2026-03-01T00:00:00Z',
};

export function getRecords(
  fixture: WorkoutFixture,
  query: Record<string, string | undefined> = {},
  compare = false,
  userId = 'records-user',
) {
  return request(fixture.app.getHttpServer())
    .get(`/users/${userId}/personal-records${compare ? '/compare' : ''}`)
    .query({ exerciseName: 'Bench Press', ...query });
}

export function logRecord(
  fixture: WorkoutFixture,
  key: string,
  overrides: Partial<CreateWorkoutDto> = {},
  userId = 'records-user',
) {
  return logHistory(fixture, key, overrides, userId);
}

export async function insertTiedRecord(
  fixture: WorkoutFixture,
  id: string,
  date: string,
  unit: 'kg' | 'lb',
) {
  await fixture.service.pool.query(
    `INSERT INTO workout_entries (id, user_id, exercise_id, performed_at)
     VALUES ($1, 'records-user', $2, $3)`,
    [id, benchId, date],
  );
  // 100 lb and 45.359237 kg are exactly equal, with valid six-decimal inputs.
  for (const position of [2, 1]) {
    await fixture.service.pool.query(
      `INSERT INTO workout_sets
       (id, entry_id, position, reps, original_weight, original_unit, weight_kg)
       VALUES ($1, $2, $3, 8, $4, $5, '45.35923700000000')`,
      [randomUUID(), id, position, unit === 'lb' ? '100' : '45.359237', unit],
    );
  }
}
