export interface ReadDatasetConfig {
  entries: number;
  setsPerEntry: number;
  seed: number;
}

export interface ReadSet {
  id: string;
  position: number;
  reps: number;
  originalWeight: string;
  originalUnit: 'kg' | 'lb';
  weightKg: string;
}

export interface ReadEntry {
  id: string;
  userId: string;
  date: string;
  createdAt: string;
  exercise: { id: string; name: string; muscleGroups: string[] };
  sets: ReadSet[];
}

const exercises = [
  { name: 'Bench Press', muscleGroups: ['chest', 'triceps'] },
  { name: 'Squat', muscleGroups: ['glutes', 'quadriceps'] },
  { name: 'Deadlift', muscleGroups: ['glutes', 'hamstrings'] },
  { name: 'Push Up', muscleGroups: ['chest', 'triceps'] },
].map((exercise, index) => ({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ...exercise,
}));

function id(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

/** Integer arithmetic constructs exact NUMERIC fixtures without application code. */
export function buildReadDataset(config: ReadDatasetConfig): ReadEntry[] {
  if (
    !Number.isSafeInteger(config.entries) ||
    config.entries < 1 ||
    !Number.isInteger(config.setsPerEntry) ||
    config.setsPerEntry < 1 ||
    config.setsPerEntry > 100 ||
    !Number.isSafeInteger(config.seed)
  ) {
    throw new Error('Invalid read benchmark dataset configuration');
  }
  const seed = ((config.seed % 997) + 997) % 997;
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  const lastPrimarySlot = Math.floor((config.entries - 1) / 4);
  return Array.from({ length: config.entries + 1000 }, (_, index) => {
    const isPrimary = index < config.entries;
    const ownIndex = isPrimary ? index : index - config.entries;
    const slot = isPrimary
      ? Math.floor(ownIndex / 4)
      : ownIndex === 0
        ? lastPrimarySlot + 1
        : Math.floor(((ownIndex - 1) * lastPrimarySlot) / 998);
    return {
      id: id('30000000', index + 1),
      userId: index < config.entries ? 'performance-user' : 'performance-other',
      date: new Date(start + slot * 900_000).toISOString(),
      createdAt: '2026-06-01T00:00:00.000Z',
      exercise: exercises[ownIndex % exercises.length]!,
      sets: Array.from({ length: config.setsPerEntry }, (_, position) => {
        const value =
          1 +
          ((ownIndex * 17 + position * 31 + seed) % 250) +
          (isPrimary ? 0 : 10000);
        const originalUnit = (ownIndex + position) % 2 === 0 ? 'kg' : 'lb';
        const scaledKg =
          BigInt(value) *
          (originalUnit === 'kg' ? 100_000_000_000_000n : 45_359_237_000_000n);
        const digits = scaledKg.toString().padStart(15, '0');
        return {
          id: id('40000000', index * config.setsPerEntry + position + 1),
          position: position + 1,
          reps: 1 + ((ownIndex * 7 + position * 11 + seed) % 25),
          originalWeight: `${value}.000000`,
          originalUnit,
          weightKg: `${digits.slice(0, -14)}.${digits.slice(-14)}`,
        };
      }),
    };
  });
}
