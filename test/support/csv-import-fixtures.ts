import request from 'supertest';
import { setTimeout } from 'node:timers/promises';
import { CSV_HEADER } from '../../src/schemas/csv-import.schema';
import { WorkoutImportResponseSchema } from '../../src/schemas/workout-import.schema';
import type { WorkoutFixture } from './workout-fixtures';

export const csvPath = '/users/csv-user/workout-entries';
export function csvFile(entries = 1, sets = 3): Buffer {
  const rows = [CSV_HEADER];
  for (let entry = 0; entry < entries; entry++) {
    const date = new Date(Date.UTC(2026, 0, 1) + entry * 60000).toISOString();
    for (let position = 1; position <= sets; position++) {
      rows.push(
        `entry-${entry},${date},Bench Press,${position},${position + 4},${position === 1 ? '135,lb' : '0,kg'}`,
      );
    }
  }
  return Buffer.from(rows.join('\n') + '\n');
}
export function uploadCsv(
  fixture: WorkoutFixture,
  source = csvFile(),
  key = 'csv-key',
) {
  return request(fixture.app.getHttpServer())
    .post(`${csvPath}/bulk/csv`)
    .set('Idempotency-Key', key)
    .attach('file', source, 'workouts.csv');
}
export async function readImport(fixture: WorkoutFixture, id: string) {
  const response = await request(fixture.app.getHttpServer())
    .get(`${csvPath}/imports/${id}`)
    .expect(200);
  return WorkoutImportResponseSchema.parse(response.body).data;
}
export async function waitImport(fixture: WorkoutFixture, id: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const job = await readImport(fixture, id);
    if (job.status === 'completed' || job.status === 'failed') return job;
    await setTimeout(20);
  }
  throw new Error('CSV import did not finish');
}
export async function resetImports(fixture: WorkoutFixture) {
  await fixture.service.pool.query(
    'TRUNCATE workout_import_batches, workout_imports',
  );
  await fixture.reset();
}
