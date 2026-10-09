import assert from 'node:assert/strict';
import {
  EMPTY_RECORDS_MESSAGE,
  RecordComparisonResponseSchema,
  RecordResponseSchema,
  type PersonalRecords,
} from '../src/schemas/personal-record-response.schema';
import type { WorkoutEntry } from '../src/schemas/workout-response.schema';
import type { SmokeHttp } from './smoke-http';

function expectedRecords(
  entry: WorkoutEntry,
  values: string[],
): PersonalRecords {
  const record = <T extends 'kg' | 'kg*reps'>(index: number, unit: T) => ({
    value: values[index]!,
    unit,
    achievedAt: entry.date,
    entryId: entry.id,
    setPosition: 1,
    reps: 8,
    weight: entry.sets[0]!.weight,
    weightUnit: 'kg' as const,
  });
  return {
    heaviestSet: record(0, 'kg'),
    highestVolumeSet: record(1, 'kg*reps'),
    estimatedOneRepMax: record(2, 'kg'),
  };
}

export async function smokeRecords(
  http: SmokeHttp,
  user: string,
  baseline: WorkoutEntry,
  comparison: WorkoutEntry,
) {
  http.stage = 'personal records and comparison';
  const path = `/users/${user}/personal-records`;
  const query = '?exerciseName=Bench%20Press';
  const previous = expectedRecords(baseline, [
    '60.0000',
    '480.0000',
    '76.0000',
  ]);
  const current = expectedRecords(comparison, [
    '70.0000',
    '560.0000',
    '88.6667',
  ]);
  assert.deepEqual(await http.request(path + query, RecordResponseSchema), {
    data: current,
    message: null,
  });
  const baselineRange = {
    from: '2020-01-01T00:00:00.000Z',
    to: '2020-02-01T00:00:00.000Z',
  };
  const comparisonRange = {
    from: baselineRange.to,
    to: '2020-03-01T00:00:00.000Z',
  };
  const periods = new URLSearchParams({
    exerciseName: 'Bench Press',
    baselineFrom: baselineRange.from,
    baselineTo: baselineRange.to,
    comparisonFrom: comparisonRange.from,
    comparisonTo: comparisonRange.to,
  });
  const result = await http.request(
    `${path}/compare?${periods}`,
    RecordComparisonResponseSchema,
  );
  assert.deepEqual(result.data, {
    baseline: { range: baselineRange, records: previous, message: null },
    comparison: { range: comparisonRange, records: current, message: null },
    differences: {
      heaviestSet: { value: '10.0000', unit: 'kg' },
      highestVolumeSet: { value: '80.0000', unit: 'kg*reps' },
      estimatedOneRepMax: { value: '12.6667', unit: 'kg' },
    },
  });
  const empty = {
    heaviestSet: null,
    highestVolumeSet: null,
    estimatedOneRepMax: null,
  };
  assert.deepEqual(
    await http.request(
      `${path}${query}&from=2099-01-01T00:00:00Z`,
      RecordResponseSchema,
    ),
    { data: empty, message: EMPTY_RECORDS_MESSAGE },
  );
  periods.set('comparisonFrom', '2099-01-01T00:00:00Z');
  periods.set('comparisonTo', '2099-02-01T00:00:00Z');
  const emptyPeriod = await http.request(
    `${path}/compare?${periods}`,
    RecordComparisonResponseSchema,
  );
  assert.deepEqual(emptyPeriod.data.comparison.records, empty);
  assert.equal(emptyPeriod.data.comparison.message, EMPTY_RECORDS_MESSAGE);
  assert.deepEqual(emptyPeriod.data.differences, empty);
  await http.error(`${path}?exerciseName=does-not-exist`, 400);
  await http.error(
    `${path}${query}&from=2020-02-01T00:00:00Z&to=2020-01-01T00:00:00Z`,
    400,
  );
}
