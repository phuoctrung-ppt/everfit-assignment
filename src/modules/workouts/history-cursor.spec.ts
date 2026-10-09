import { HistoryQuerySchema } from '../../schemas/history-query.schema';
import { encodeCursor } from '../../schemas/pagination.schema';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyFilterDigest,
} from './history-cursor';

describe('history cursor', () => {
  const query = HistoryQuerySchema.parse({
    exerciseName: ' Bench ',
    from: '2026-01-01T00:00:00Z',
  });
  const digest = historyFilterDigest('user-1', query);
  const cursor = {
    version: 1 as const,
    date: '2026-01-02T00:00:00.123Z',
    id: '10000000-0000-4000-8000-000000000001',
    filterDigest: digest,
  };

  it('round trips and binds normalized filters without binding page size', () => {
    expect(decodeHistoryCursor(encodeHistoryCursor(cursor), digest)).toEqual(
      cursor,
    );
    expect(
      historyFilterDigest(
        'user-1',
        HistoryQuerySchema.parse({
          exerciseName: 'bench',
          from: '2026-01-01T00:00:00.000Z',
          limit: '100',
        }),
      ),
    ).toBe(digest);
    expect(
      historyFilterDigest('user-1', { ...query, cursor: 'anything' }),
    ).toBe(digest);
  });

  it.each([
    'user-2',
    { ...query, unit: 'lb' as const },
    { ...query, muscleGroup: 'chest' },
    { ...query, exerciseName: 'squat' },
    { ...query, from: undefined },
    { ...query, to: '2026-02-01T00:00:00Z' },
  ])('rejects changed user/filter binding %j', (change) => {
    const expected =
      typeof change === 'string'
        ? historyFilterDigest(change, query)
        : historyFilterDigest('user-1', change);
    expect(() =>
      decodeHistoryCursor(encodeHistoryCursor(cursor), expected),
    ).toThrow();
  });

  it.each([
    '',
    '!',
    'a'.repeat(4097),
    'e30=',
    'a',
    Buffer.from('{bad json').toString('base64url'),
    Buffer.from([0xff]).toString('base64url'),
    encodeCursor({ ...cursor, version: 2 }),
    encodeCursor({ ...cursor, date: '2026-02-30T00:00:00Z' }),
    encodeCursor({ ...cursor, id: 'bad' }),
    encodeCursor({ ...cursor, extra: true }),
    encodeCursor({ ...cursor, filterDigest: 'bad' }),
    encodeCursor({ v: 1, resource: 'exercises', id: cursor.id }),
  ])('rejects malformed or foreign cursor %s', (value) => {
    expect(() => decodeHistoryCursor(value, digest)).toThrow();
  });
});
