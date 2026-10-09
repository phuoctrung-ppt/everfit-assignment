import { randomUUID } from 'node:crypto';
import { WorkoutEntrySchema } from '../src/schemas/workout-response.schema';
import {
  emptyHistory,
  entryIds,
  getHistory,
  logHistory,
} from './support/history-fixtures';
import {
  createWorkoutFixture,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('filtered workout history against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('composes normalized name/group filters and preserves all groups without duplicates', async () => {
    const bench = await logHistory(fixture, 'bench');
    await logHistory(fixture, 'squat', { exerciseName: 'Squat' });
    await logHistory(fixture, 'other', {}, 'other-user');
    const result = await getHistory(fixture, {
      exerciseName: ' bEnCh ',
      muscleGroup: ' CHEST ',
    }).expect(200);
    expect(entryIds(result.body)).toEqual([bench.id]);
    expect(result.body.data[0].exercise.muscleGroups).toEqual([
      'chest',
      'triceps',
    ]);
    expect(result.body.pagination).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(result.body.message).toBeNull();
    expect(entryIds((await getHistory(fixture).expect(200)).body)).toHaveLength(
      2,
    );
  });

  it.each(['%', '_', '\\', "'; DROP TABLE workout_entries; --"])(
    'matches %s literally instead of interpreting SQL syntax',
    async (literal) => {
      const name = `Literal ${literal} Exercise`;
      await fixture.service.pool.query(
        'INSERT INTO exercises (id, name, normalized_name) VALUES ($1, $2, $3)',
        [randomUUID(), name, name.toLowerCase()],
      );
      const matching = await logHistory(fixture, 'literal', {
        exerciseName: name,
      });
      await logHistory(fixture, 'ordinary');
      const result = await getHistory(fixture, {
        exerciseName: literal,
      }).expect(200);
      expect(entryIds(result.body)).toEqual([matching.id]);
      expect((await fixture.counts()).entries).toBe(2);
    },
  );

  it.each([
    {},
    { exerciseName: 'unknown' },
    { muscleGroup: 'unknown' },
    { muscleGroup: 'ches' },
  ])('returns the defined empty response for %j', async (query) => {
    if (Object.keys(query).length) await logHistory(fixture, 'entry');
    expect((await getHistory(fixture, query).expect(200)).body).toEqual(
      emptyHistory,
    );
  });

  it('includes the start, excludes the end, and supports open-ended ranges', async () => {
    const dates = [
      '2026-01-01T23:59:59.999Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-02T23:59:59.999Z',
      '2026-01-03T00:00:00.000Z',
    ];
    const entries = [];
    for (const date of dates)
      entries.push(await logHistory(fixture, date, { date }));
    const from = dates[1]!;
    const to = dates[3]!;
    const range = await getHistory(fixture, { from, to }).expect(200);
    expect(entryIds(range.body)).toEqual([entries[2]!.id, entries[1]!.id]);
    const after = await getHistory(fixture, { from }).expect(200);
    expect(entryIds(after.body)).toEqual(
      entries
        .slice(1)
        .reverse()
        .map((e) => e.id),
    );
    const before = await getHistory(fixture, { to }).expect(200);
    expect(entryIds(before.body)).toEqual(
      entries
        .slice(0, 3)
        .reverse()
        .map((e) => e.id),
    );
  });

  it('converts from exact canonical weight and preserves ordered originals in both units', async () => {
    const created = await logHistory(fixture, 'mixed', {
      sets: [
        { reps: 5, weight: 135, unit: 'lb' },
        { reps: 8, weight: 100, unit: 'kg' },
        { reps: 10, weight: 0, unit: 'kg' },
      ],
    });
    for (const [unit, weights] of [
      ['kg', ['61.2350', '100.0000', '0.0000']],
      ['lb', ['135.0000', '220.4623', '0.0000']],
    ] as const) {
      const result = await getHistory(fixture, { unit }).expect(200);
      const entry = WorkoutEntrySchema.parse(result.body.data[0]);
      expect(entry.sets).toEqual(
        created.sets.map((set, i) => ({
          ...set,
          unit,
          weight: weights[i],
        })),
      );
      expect(JSON.stringify(result.body)).not.toMatch(/weightKg|weight_kg/);
    }
    expect((await getHistory(fixture).expect(200)).body.data[0]).toEqual(
      created,
    );
  });
});
