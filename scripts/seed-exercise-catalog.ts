import type { DatabaseService } from '../src/database/database.service';
import { normalizeExerciseName } from '../src/modules/exercises/exercise.types';
import { ExerciseCatalogSchema } from '../src/schemas/exercise-catalog.schema';

export async function seedExerciseCatalog(
  database: DatabaseService,
  input: unknown,
): Promise<void> {
  // Validate the entire catalog before acquiring a connection or making changes.
  const catalog = ExerciseCatalogSchema.parse(input);
  const groups = new Map(
    catalog.muscleGroups.map((group) => [group.name, group.id]),
  );
  await database.withTransaction(async (client) => {
    // Serializes this small administrative operation across simultaneous seeds.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('everfit:catalog-seed'))",
    );
    for (const group of catalog.muscleGroups) {
      await client.query(
        `INSERT INTO muscle_groups (id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [group.id, group.name],
      );
    }
    for (const exercise of catalog.exercises) {
      await client.query(
        `INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name`,
        [exercise.id, exercise.name, normalizeExerciseName(exercise.name)],
      );
      await client.query(
        'DELETE FROM exercise_muscle_groups WHERE exercise_id = $1',
        [exercise.id],
      );
      for (const groupName of exercise.muscleGroups) {
        await client.query(
          'INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id) VALUES ($1, $2)',
          [exercise.id, groups.get(groupName)],
        );
      }
    }
  });
}
