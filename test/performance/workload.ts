import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BulkWorkoutResponseSchema } from '../../src/schemas/workout-logging.schema';
import type { BulkWorkoutDto } from '../../src/schemas/workout.schema';

export const PRIMARY_USER = 'performance-primary';
export const SECONDARY_USER = 'performance-secondary';
export const exercises = ['Bench Press', 'Squat', 'Deadlift', 'Push Up'];
const weights = [
  { weight: 135, unit: 'lb' as const, original: '135.000000', kg: '61.2350' },
  { weight: 60, unit: 'kg' as const, original: '60.000000', kg: '60.0000' },
  { weight: 0, unit: 'kg' as const, original: '0.000000', kg: '0.0000' },
];
export function bulkBody(setsPerEntry = 10, batch = 0): BulkWorkoutDto {
  return {
    entries: Array.from({ length: 100 }, (_, index) => ({
      date: new Date(
        Date.UTC(2026, (batch + index) % 6, 1 + (index % 28)),
      ).toISOString(),
      exerciseName: exercises[index % exercises.length]!,
      sets: Array.from({ length: setsPerEntry }, (_, position) => ({
        reps: 5 + position,
        weight: weights[position % 3]!.weight,
        unit: weights[position % 3]!.unit,
      })),
    })),
  };
}
export interface Counts {
  entries: number;
  sets: number;
  requests: number;
}
export class Workload {
  readonly expected = new Map<string, Counts>();
  private readonly committed = new Map<string, string>();
  constructor(
    private readonly url: string,
    private readonly signal?: AbortSignal,
  ) {}

  async post(
    key: string,
    body: BulkWorkoutDto,
    status = 201,
    fresh = false,
    user = PRIMARY_USER,
    replay?: unknown,
  ) {
    const started = performance.now();
    const response = await fetch(
      `${this.url}/users/${user}/workout-entries/bulk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          AbortSignal.timeout(15000),
          ...(this.signal ? [this.signal] : []),
        ]),
      },
    );
    const text = await response.text();
    const elapsedMs = performance.now() - started;
    assert.equal(
      response.status,
      status,
      `Unexpected HTTP status (expected ${status})`,
    );
    const json: unknown = JSON.parse(text);
    if (status === 201) {
      const parsed = BulkWorkoutResponseSchema.parse(json);
      assert.equal(parsed.data.length, body.entries.length);
      parsed.data.forEach((entry, index) => {
        const input = body.entries[index]!;
        assert.equal(entry.userId, user);
        assert.equal(entry.exercise.name, input.exerciseName);
        assert.equal(entry.date, input.date);
        assert.equal(entry.sets.length, input.sets.length);
        entry.sets.forEach((set, position) => {
          assert.equal(set.position, position + 1);
          assert.equal(set.reps, input.sets[position]!.reps);
          assert.equal(set.originalWeight, weights[position % 3]!.original);
          assert.equal(set.originalUnit, input.sets[position]!.unit);
          assert.equal(set.weight, weights[position % 3]!.kg);
          assert.equal(set.unit, 'kg');
        });
      });
      if (replay) assert.deepEqual(json, replay);
      if (fresh) {
        const identity = `${user}/${key}`;
        const digest = createHash('sha256')
          .update(JSON.stringify(parsed))
          .digest('hex');
        const previous = this.committed.get(identity);
        if (previous) {
          assert.equal(
            digest,
            previous,
            'Concurrent same-key response changed',
          );
          return { elapsedMs, json };
        }
        this.committed.set(identity, digest);
        const counts = this.expected.get(user) ?? {
          entries: 0,
          sets: 0,
          requests: 0,
        };
        counts.entries += body.entries.length;
        counts.sets += body.entries.reduce(
          (total, entry) => total + entry.sets.length,
          0,
        );
        counts.requests++;
        this.expected.set(user, counts);
      }
    } else {
      assert.ok(typeof json === 'object' && json !== null && 'error' in json);
      assert.ok(
        typeof json.error === 'object' &&
          json.error !== null &&
          'code' in json.error,
      );
      assert.equal(
        json.error.code,
        status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION_ERROR',
      );
    }
    return { elapsedMs, json };
  }
}

// At most concurrency response bodies live at once; never enqueue the entire dataset.
export async function runRequests(
  count: number,
  concurrency: number,
  work: (index: number) => Promise<{ elapsedMs: number }>,
): Promise<number[]> {
  const timings: number[] = [];
  let next = 0;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count && !failure) {
        const index = next++;
        try {
          timings.push((await work(index)).elapsedMs);
        } catch (error) {
          failure = error;
        }
      }
    }),
  );
  if (failure) throw failure;
  assert.equal(timings.length, count);
  return timings;
}
