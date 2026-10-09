import assert from 'node:assert/strict';
import { HistoryQuerySchema } from '../../src/schemas/history-query.schema';
import {
  encodeHistoryCursor,
  historyFilterDigest,
} from '../../src/modules/workouts/history-cursor';
import type { ReadEntry } from './read-dataset';
import { expectedHistory, expectedRecords } from './read-oracle';

export interface ReadScenario {
  name: string;
  route: string;
  query: Record<string, string>;
  userId: string;
  targetMs: number;
  expected: unknown;
  after?: { date: string; id: string };
}

export function readScenarios(dataset: ReadEntry[]): ReadScenario[] {
  const userId = 'performance-user';
  const primary = dataset
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const boundary = primary[Math.floor(primary.length * 0.9) - 1]!;
  const after = { date: boundary.date, id: boundary.id };
  const february = { from: '2026-02-01T00:00:00Z', to: '2026-03-01T00:00:00Z' };
  const history = (
    name: string,
    query: Record<string, string> = {},
    deep = false,
  ): ReadScenario => {
    const filters = { limit: '20', unit: 'kg', ...query };
    if (deep)
      Object.assign(filters, {
        cursor: encodeHistoryCursor({
          version: 1,
          ...after,
          filterDigest: historyFilterDigest(
            userId,
            HistoryQuerySchema.parse(filters),
          ),
        }),
      });
    const { data, message, hasMore } = expectedHistory(
      dataset,
      filters,
      userId,
      deep ? after : undefined,
    );
    const last = data.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeHistoryCursor({
            version: 1,
            date: last.date,
            id: last.id,
            filterDigest: historyFilterDigest(
              userId,
              HistoryQuerySchema.parse(filters),
            ),
          })
        : null;
    return {
      name,
      route: 'workout-entries',
      query: filters,
      userId,
      targetMs: 250,
      expected: { data, message, pagination: { hasMore, nextCursor } },
      after: deep ? after : undefined,
    };
  };
  const records = (
    name: string,
    query: Record<string, string>,
    compare = false,
  ): ReadScenario => {
    const filters = { exerciseName: 'Bench Press', unit: 'kg', ...query };
    return {
      name,
      route: `personal-records${compare ? '/compare' : ''}`,
      query: filters,
      userId,
      targetMs: 500,
      expected: expectedRecords(dataset, filters, userId, compare),
    };
  };
  assert.equal(primary.length >= 50000, true);
  return [
    history('history-first'),
    history('history-deep-90-percent', {}, true),
    history('history-exercise', { exerciseName: 'bench' }),
    history('history-date', february),
    history('history-combined-lb', {
      ...february,
      exerciseName: 'bench',
      muscleGroup: 'chest',
      unit: 'lb',
    }),
    history('history-group', { muscleGroup: 'chest' }),
    records('records-all-time', {}),
    records('records-month-lb', { ...february, unit: 'lb' }),
    records(
      'records-comparison',
      {
        baselineFrom: '2026-01-01T00:00:00Z',
        baselineTo: '2026-02-01T00:00:00Z',
        comparisonFrom: february.from,
        comparisonTo: february.to,
      },
      true,
    ),
  ];
}
