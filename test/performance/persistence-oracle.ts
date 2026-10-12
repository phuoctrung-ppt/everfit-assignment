import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Pool, QueryResult } from 'pg';
import type { CreateWorkoutDto } from '../../src/schemas/workout.schema';
import type { WorkoutEntry } from '../../src/schemas/workout-response.schema';

type StoredSet = [string, number, number, string, string, string];
interface StoredEntry {
  id: string;
  user_id: string;
  exercise_id: string;
  name: string;
  performed_at: Date;
  created_at: Date;
  sets: StoredSet[];
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Inputs allow six decimal places. Integer arithmetic is independent of the
// application's decimal.js conversion and response rounding implementation.
function exactKg(weight: number, unit: 'kg' | 'lb'): string {
  const micros = BigInt(weight.toFixed(6).replace('.', ''));
  const scaled = micros * (unit === 'kg' ? 100_000_000n : 45_359_237n);
  const digits = scaled.toString().padStart(15, '0');
  return `${digits.slice(0, -14)}.${digits.slice(-14)}`;
}

export function expectedPersistenceDigest(
  user: string,
  input: CreateWorkoutDto,
  response: WorkoutEntry,
): string {
  return digest([
    response.id,
    user,
    new Date(input.date).toISOString(),
    response.createdAt,
    response.exercise.id,
    input.exerciseName.trim(),
    input.sets.map((set, index) => [
      response.sets[index]!.id,
      index + 1,
      set.reps,
      set.weight.toFixed(6),
      set.unit,
      exactKg(set.weight, set.unit),
    ]),
  ]);
}

/** Run only at idle checkpoints on the isolated database, outside measurements. */
export async function verifyPersistedWorkouts(
  pool: Pool,
  expected: ReadonlyMap<string, string>,
) {
  let cursor: string | null = null;
  let entries = 0;
  let sets = 0;
  while (true) {
    const result: QueryResult<StoredEntry> = await pool.query<StoredEntry>(
      `WITH page AS (
         SELECT * FROM workout_entries
         WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 250
       )
       SELECT e.*, x.name,
         COALESCE(jsonb_agg(jsonb_build_array(s.id, s.position, s.reps,
           s.original_weight::text, s.original_unit, s.weight_kg::text)
           ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS sets
       FROM page e JOIN exercises x ON x.id = e.exercise_id
       LEFT JOIN workout_sets s ON s.entry_id = e.id
       GROUP BY e.id, e.user_id, e.exercise_id, e.performed_at, e.created_at, x.name
       ORDER BY e.id`,
      [cursor],
    );
    if (!result.rows.length) break;
    for (const row of result.rows) {
      const actual = digest([
        row.id,
        row.user_id,
        row.performed_at.toISOString(),
        row.created_at.toISOString(),
        row.exercise_id,
        row.name,
        row.sets,
      ]);
      assert.equal(
        actual,
        expected.get(row.id),
        `Persistence mismatch: ${row.id}`,
      );
      entries++;
      sets += row.sets.length;
    }
    cursor = result.rows.at(-1)!.id;
  }
  assert.equal(entries, expected.size, 'Missing persisted workout entries');
  return { entries, sets };
}
