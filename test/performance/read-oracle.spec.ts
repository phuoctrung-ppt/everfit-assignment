import { buildReadDataset, type ReadEntry } from './read-dataset';
import { expectedHistory, expectedRecords } from './read-oracle';
import { display } from './read-oracle-math';

function entry(id: number, weight: number, reps: number, day = 1): ReadEntry {
  return {
    id: `30000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    userId: 'performance-user',
    date: `2026-01-0${day}T00:00:00.000Z`,
    createdAt: '2026-06-01T00:00:00.000Z',
    exercise: {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Bench Press',
      muscleGroups: ['chest', 'triceps'],
    },
    sets: [
      {
        id: `40000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
        position: 1,
        reps,
        originalWeight: `${weight}.000000`,
        originalUnit: 'kg',
        weightKg: `${weight}.00000000000000`,
      },
    ],
  };
}

describe('independent read benchmark oracle', () => {
  it('makes cross-user contamination visible in recent history and monthly records', () => {
    const data = buildReadDataset({
      entries: 50000,
      setsPerEntry: 2,
      seed: 17,
    });
    const primary = data.slice(0, 50000);
    const secondary = data.slice(50000);
    const largestPrimary = Math.max(
      ...primary.flatMap((row) => row.sets.map((set) => Number(set.weightKg))),
    );
    const largestSecondary = Math.max(
      ...secondary.flatMap((row) =>
        row.sets.map((set) => Number(set.weightKg)),
      ),
    );
    expect(largestSecondary).toBeGreaterThan(largestPrimary);
    expect(secondary).toHaveLength(1000);
    expect(secondary[0]!.date > primary.at(-1)!.date).toBe(true);
    expect(secondary.some((row) => row.date.startsWith('2026-02'))).toBe(true);
  });

  it('selects three distinct winners from hand-calculated Epley and volume values', () => {
    const data = [entry(1, 100, 1), entry(2, 60, 20), entry(3, 90, 8)];
    expect(expectedRecords(data, { exerciseName: ' BENCH PRESS ' })).toEqual({
      data: {
        heaviestSet: {
          value: '100.0000',
          unit: 'kg',
          achievedAt: data[0]!.date,
          entryId: data[0]!.id,
          setPosition: 1,
          reps: 1,
          weight: '100.0000',
          weightUnit: 'kg',
        },
        highestVolumeSet: {
          value: '1200.0000',
          unit: 'kg*reps',
          achievedAt: data[1]!.date,
          entryId: data[1]!.id,
          setPosition: 1,
          reps: 20,
          weight: '60.0000',
          weightUnit: 'kg',
        },
        estimatedOneRepMax: {
          value: '114.0000',
          unit: 'kg',
          achievedAt: data[2]!.date,
          entryId: data[2]!.id,
          setPosition: 1,
          reps: 8,
          weight: '90.0000',
          weightUnit: 'kg',
        },
      },
      message: null,
    });
  });

  it('breaks record ties by earliest date, ID, then position regardless of input order', () => {
    const winner = entry(1, 100, 5);
    winner.sets.unshift({ ...winner.sets[0]!, position: 2 });
    const actual = expectedRecords(
      [entry(3, 100, 5, 2), entry(2, 100, 5), winner],
      { exerciseName: 'Bench Press' },
    );
    expect(actual).toMatchObject({
      data: {
        heaviestSet: { entryId: winner.id, setPosition: 1 },
        highestVolumeSet: { entryId: winner.id, setPosition: 1 },
        estimatedOneRepMax: { entryId: winner.id, setPosition: 1 },
      },
    });
  });

  it('subtracts exact values before rounding signed comparison differences', () => {
    const actual = expectedRecords(
      [entry(1, 70, 8), entry(2, 60, 8, 2)],
      {
        exerciseName: 'Bench Press',
        baselineFrom: '2026-01-01T00:00:00Z',
        baselineTo: '2026-01-02T00:00:00Z',
        comparisonFrom: '2026-01-02T00:00:00Z',
        comparisonTo: '2026-01-03T00:00:00Z',
      },
      'performance-user',
      true,
    );
    expect(actual).toMatchObject({
      data: {
        differences: {
          heaviestSet: { value: '-10.0000', unit: 'kg' },
          highestVolumeSet: { value: '-80.0000', unit: 'kg*reps' },
          estimatedOneRepMax: { value: '-12.6667', unit: 'kg' },
        },
      },
    });
  });

  it('filters users/ranges and traverses equal-date history IDs without repeats', () => {
    const other = { ...entry(9, 999, 1), userId: 'performance-other' };
    const data = [
      entry(1, 100, 1),
      entry(2, 60, 20),
      entry(3, 90, 8, 2),
      other,
    ];
    const query = {
      exerciseName: 'BENCH',
      muscleGroup: 'CHEST',
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-02T00:00:00Z',
      limit: '1',
    };
    const first = expectedHistory(data, query);
    expect(first.data.map((item) => item.id)).toEqual([data[1]!.id]);
    expect(first.hasMore).toBe(true);
    const second = expectedHistory(
      data,
      query,
      'performance-user',
      first.data[0],
    );
    expect(second.data.map((item) => item.id)).toEqual([data[0]!.id]);
    expect(second.hasMore).toBe(false);
    expect(second.data[0]!.sets[0]).toMatchObject({
      weight: '100.0000',
      unit: 'kg',
    });
  });

  it('rounds rational values and pounds exactly, normalizing negative zero', () => {
    expect(display(45359237n, 100000000n, 'lb')).toBe('1.0000');
    expect(display(100005n, 100000n, 'kg')).toBe('1.0001');
    expect(display(-100005n, 100000n, 'kg')).toBe('-1.0001');
    expect(display(-1n, 100000n, 'kg')).toBe('0.0000');
  });

  it('constructs seeded mixed-unit datasets reproducibly with exact normalized weights', () => {
    const config = { entries: 4, setsPerEntry: 2, seed: 0 };
    const data = buildReadDataset(config);
    expect(data).toEqual(buildReadDataset(config));
    expect(data).toHaveLength(1004);
    expect(
      data.filter((item) => item.userId === 'performance-user'),
    ).toHaveLength(4);
    expect(data[0]!.sets[0]).toMatchObject({
      originalWeight: '1.000000',
      weightKg: '1.00000000000000',
    });
    expect(data[0]!.sets[1]).toMatchObject({
      originalWeight: '32.000000',
      originalUnit: 'lb',
      weightKg: '14.51495584000000',
    });
    expect(data[0]!.sets).not.toEqual(
      buildReadDataset({ ...config, seed: 1 })[0]!.sets,
    );
  });
});
