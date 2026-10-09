import type { ReadEntry, ReadSet } from './read-dataset';
import { display } from './read-oracle-math';
import type {
  PersonalRecords,
  RecordComparisonResponse,
  RecordResponse,
} from '../../src/schemas/personal-record-response.schema';
const metrics = [
  'heaviestSet',
  'highestVolumeSet',
  'estimatedOneRepMax',
] as const;
type Metric = (typeof metrics)[number];
type Winner = { entry: ReadEntry; set: ReadSet; numerator: bigint };
const scale = 100_000_000_000_000n;
const emptyMessage =
  'No workout entries found for the requested exercise and range.';
function within(entry: ReadEntry, from?: string, to?: string): boolean {
  const date = Date.parse(entry.date);
  return (!from || date >= Date.parse(from)) && (!to || date < Date.parse(to));
}
function ascending(a: ReadEntry, b: ReadEntry): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}
export function expectedHistory(
  dataset: ReadEntry[],
  query: Record<string, string>,
  userId = 'performance-user',
  after?: { date: string; id: string },
) {
  const unit = query.unit === 'lb' ? 'lb' : 'kg';
  const selected = dataset
    .filter(
      (entry) =>
        entry.userId === userId &&
        within(entry, query.from, query.to) &&
        (!query.exerciseName ||
          entry.exercise.name
            .toLowerCase()
            .includes(query.exerciseName.trim().toLowerCase())) &&
        (!query.muscleGroup ||
          entry.exercise.muscleGroups.includes(
            query.muscleGroup.trim().toLowerCase(),
          )) &&
        (!after ||
          entry.date < after.date ||
          (entry.date === after.date && entry.id < after.id)),
    )
    .sort((a, b) => ascending(b, a));
  const limit = Number(query.limit ?? 20);
  const data = selected.slice(0, limit).map((entry) => ({
    ...entry,
    sets: entry.sets.map(({ weightKg, ...set }) => ({
      ...set,
      weight: display(BigInt(weightKg.replace('.', '')), scale, unit),
      unit,
    })),
  }));
  return {
    data,
    hasMore: selected.length > limit,
    message: data.length
      ? null
      : 'No workout entries found for the requested filters.',
  };
}
function select(
  dataset: ReadEntry[],
  userId: string,
  name: string,
  from?: string,
  to?: string,
) {
  const winners: Record<Metric, Winner | null> = {
    heaviestSet: null,
    highestVolumeSet: null,
    estimatedOneRepMax: null,
  };
  for (const entry of dataset) {
    if (
      entry.userId !== userId ||
      entry.exercise.name.toLowerCase() !== name ||
      !within(entry, from, to)
    )
      continue;
    for (const set of entry.sets) {
      const kg = BigInt(set.weightKg.replace('.', ''));
      const values = [kg, kg * BigInt(set.reps), kg * BigInt(30 + set.reps)];
      metrics.forEach((metric, index) => {
        const old = winners[metric];
        const numerator = values[index]!;
        if (
          !old ||
          numerator > old.numerator ||
          (numerator === old.numerator &&
            (ascending(entry, old.entry) < 0 ||
              (entry.id === old.entry.id && set.position < old.set.position)))
        ) {
          winners[metric] = { entry, set, numerator };
        }
      });
    }
  }
  return winners;
}
function records(
  winners: Record<Metric, Winner | null>,
  unit: 'kg' | 'lb',
): PersonalRecords {
  const result: PersonalRecords = {
    heaviestSet: null,
    highestVolumeSet: null,
    estimatedOneRepMax: null,
  };
  for (const metric of metrics) {
    const winner = winners[metric];
    if (!winner) continue;
    const record = {
      value: display(
        winner.numerator,
        scale * (metric === 'estimatedOneRepMax' ? 30n : 1n),
        unit,
      ),
      achievedAt: winner.entry.date,
      entryId: winner.entry.id,
      setPosition: winner.set.position,
      reps: winner.set.reps,
      weight: display(
        BigInt(winner.set.weightKg.replace('.', '')),
        scale,
        unit,
      ),
      weightUnit: unit,
    };
    if (metric === 'highestVolumeSet') {
      result[metric] = { ...record, unit: `${unit}*reps` };
    } else {
      result[metric] = { ...record, unit };
    }
  }
  return result;
}
export function expectedRecords(
  dataset: ReadEntry[],
  query: Record<string, string>,
  userId = 'performance-user',
  compare = false,
): RecordResponse | RecordComparisonResponse {
  const unit = query.unit === 'lb' ? 'lb' : 'kg';
  const name = query.exerciseName!.trim().toLowerCase();
  const get = (from?: string, to?: string) =>
    select(dataset, userId, name, from, to);
  if (!compare) {
    const data = records(get(query.from, query.to), unit);
    return { data, message: data.heaviestSet ? null : emptyMessage };
  }
  const baseline = get(query.baselineFrom, query.baselineTo);
  const comparison = get(query.comparisonFrom, query.comparisonTo);
  const period = (
    winners: typeof baseline,
    from: string,
    to: string,
  ): RecordComparisonResponse['data']['baseline'] => ({
    range: { from, to },
    records: records(winners, unit),
    message: winners.heaviestSet ? null : emptyMessage,
  });
  const differences: RecordComparisonResponse['data']['differences'] = {
    heaviestSet: null,
    highestVolumeSet: null,
    estimatedOneRepMax: null,
  };
  for (const metric of metrics) {
    const a = baseline[metric];
    const b = comparison[metric];
    if (a && b) {
      const value = display(
        b.numerator - a.numerator,
        scale * (metric === 'estimatedOneRepMax' ? 30n : 1n),
        unit,
      );
      if (metric === 'highestVolumeSet')
        differences[metric] = { value, unit: `${unit}*reps` };
      else differences[metric] = { value, unit };
    }
  }
  return {
    data: {
      baseline: period(baseline, query.baselineFrom!, query.baselineTo!),
      comparison: period(
        comparison,
        query.comparisonFrom!,
        query.comparisonTo!,
      ),
      differences,
    },
  };
}
