import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import type { WorkoutEntry } from '../../src/schemas/workout-response.schema';
import type { PersistenceCase } from './persistence-cases';

export interface PersistedWrite {
  userId: string;
  key: string;
  bulk: boolean;
  cases: PersistenceCase[];
  body: object;
  response: { data: WorkoutEntry | WorkoutEntry[] };
  entries: WorkoutEntry[];
  before: Date;
  after: Date;
}

function decimal(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

// Independent integer oracle: millionths of input times 45359237 / 10^8
// for pounds produces kg at scale 14, without floating point multiplication.
function expectedWeights(weight: number, unit: 'kg' | 'lb') {
  const [whole, fraction = ''] = String(weight).split('.');
  const millionths = BigInt(`${whole}${fraction.padEnd(6, '0')}`);
  const kg = millionths * (unit === 'lb' ? 45359237n : 100000000n);
  return {
    original: decimal(millionths, 6),
    kg: decimal(kg, 14),
    display: decimal((kg + 5000000000n) / 10000000000n, 4),
  };
}

export async function readPersistence(client: Client) {
  // SELECT * intentionally checks every persisted column, including timestamps.
  const entries = await client.query(
    'SELECT * FROM workout_entries ORDER BY id',
  );
  const sets = await client.query(
    'SELECT * FROM workout_sets ORDER BY entry_id, position',
  );
  const requests = await client.query(
    'SELECT * FROM idempotency_requests ORDER BY user_id, key',
  );
  return { entries: entries.rows, sets: sets.rows, requests: requests.rows };
}

export function expectPersistence(
  actual: Awaited<ReturnType<typeof readPersistence>>,
  writes: PersistedWrite[],
) {
  const entries = writes
    .flatMap((write) =>
      write.entries.map((entry, index) => {
        const sample = write.cases[index]!;
        expect(entry).toEqual({
          id: expect.any(String),
          userId: write.userId,
          date: sample.input.date,
          createdAt: expect.any(String),
          exercise: sample.exercise,
          sets: sample.input.sets.map((set, position) => ({
            id: expect.any(String),
            position: position + 1,
            reps: set.reps,
            weight: expectedWeights(set.weight, set.unit).display,
            unit: 'kg',
            originalWeight: expectedWeights(set.weight, set.unit).original,
            originalUnit: set.unit,
          })),
        });
        const created = new Date(entry.createdAt);
        expect(created.getTime()).toBeGreaterThanOrEqual(
          write.before.getTime(),
        );
        expect(created.getTime()).toBeLessThanOrEqual(write.after.getTime());
        return {
          id: entry.id,
          user_id: write.userId,
          exercise_id: sample.exercise.id,
          performed_at: new Date(sample.input.date),
          created_at: created,
        };
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const sets = writes
    .flatMap((write) =>
      write.entries.flatMap((entry, index) =>
        write.cases[index]!.input.sets.map((set, position) => {
          const weights = expectedWeights(set.weight, set.unit);
          return {
            id: entry.sets[position]!.id,
            entry_id: entry.id,
            position: position + 1,
            reps: set.reps,
            original_weight: weights.original,
            original_unit: set.unit,
            weight_kg: weights.kg,
          };
        }),
      ),
    )
    .sort(
      (a, b) => a.entry_id.localeCompare(b.entry_id) || a.position - b.position,
    );
  const requests = writes
    .map((write) => ({
      user_id: write.userId,
      key: write.key,
      // Fixed field order gives an independent canonical JSON encoding.
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify(
            {
              version: 1,
              userId: write.userId,
              operation: write.bulk ? 'bulk' : 'single',
              body: write.body,
            },
            [
              'body',
              'date',
              'entries',
              'exerciseName',
              'operation',
              'reps',
              'sets',
              'unit',
              'userId',
              'version',
              'weight',
            ],
          ),
        )
        .digest('hex'),
      response_status: 201,
      response_body: write.response,
      created_at: new Date(write.entries[0]!.createdAt),
    }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id));
  expect(actual).toEqual({ entries, sets, requests });
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  expect(new Set(sets.map((set) => set.id)).size).toBe(sets.length);
}
