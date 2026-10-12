import assert from 'node:assert/strict';
import { HistoryResponseSchema } from '../src/schemas/history-response.schema';
import type { SmokeHttp } from './smoke-http';
import { smokeRecords } from './smoke-records';

export async function smokeCsvHistory(http: SmokeHttp, user: string) {
  http.stage = 'CSV imported history and values';
  const path = `/users/${user}/workout-entries`;
  const history = await http.request(path, HistoryResponseSchema);
  assert.equal(history.data.length, 2);
  assert.equal(history.message, null);
  assert.deepEqual(history.pagination, { hasMore: false, nextCursor: null });
  const [comparison, baseline] = history.data;
  assert(comparison && baseline);
  assert.notEqual(comparison.id, baseline.id);
  for (const [entry, date, weight] of [
    [baseline, '2020-01-10T08:00:00.000Z', '60'],
    [comparison, '2020-02-10T08:00:00.000Z', '70'],
  ] as const) {
    assert.equal(entry.userId, user);
    assert.equal(entry.date, date);
    assert.equal(entry.exercise.name, 'Bench Press');
    assert(entry.exercise.muscleGroups.includes('chest'));
    assert.equal(entry.sets.length, 1);
    const { id, ...set } = entry.sets[0]!;
    assert(id);
    assert.deepEqual(set, {
      position: 1,
      reps: 8,
      weight: `${weight}.0000`,
      unit: 'kg',
      originalWeight: `${weight}.000000`,
      originalUnit: 'kg',
    });
  }
  http.stage = 'CSV imported history filters, pounds, and pagination';
  const filters = new URLSearchParams({
    exerciseName: ' BeNcH ',
    muscleGroup: ' CHEST ',
    from: baseline.date,
    to: '2020-03-01T00:00:00Z',
    unit: 'lb',
    limit: '1',
  });
  for (const [entry, weight, hasMore] of [
    [comparison, '154.3236', true],
    [baseline, '132.2774', false],
  ] as const) {
    const page = await http.request(
      `${path}?${filters}`,
      HistoryResponseSchema,
    );
    assert.deepEqual(page.data, [
      {
        ...entry,
        sets: [{ ...entry.sets[0]!, weight, unit: 'lb' }],
      },
    ]);
    assert.equal(page.message, null);
    assert.equal(page.pagination.hasMore, hasMore);
    if (hasMore) {
      assert(page.pagination.nextCursor);
      filters.set('cursor', page.pagination.nextCursor);
    } else assert.equal(page.pagination.nextCursor, null);
  }
  await smokeRecords(http, user, baseline, comparison);
  return history;
}
