import { ExerciseCursorQuerySchema } from './exercise-query.schema';
import { CursorPaginationQuerySchema } from './pagination.schema';
import { decodeCursor, encodeCursor } from './pagination.schema';

describe('cursor query boundary', () => {
  const payload = {
    v: 1,
    resource: 'exercises',
    normalizedName: 'bench press',
    id: '10000000-0000-4000-8000-000000000001',
  };

  it('defaults only absent limits and preserves a valid opaque cursor', () => {
    expect(CursorPaginationQuerySchema.parse({})).toEqual({ limit: 20 });
    const cursor = encodeCursor(payload);
    expect(CursorPaginationQuerySchema.parse({ limit: '100', cursor })).toEqual(
      {
        limit: 100,
        cursor,
      },
    );
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it.each([null, [], ['1', '2'], {}, 1, true, '01', ' 1', '1 ', '0x10', '+1'])(
    'rejects ambiguous page sizes: %j',
    (limit) => {
      expect(CursorPaginationQuerySchema.safeParse({ limit }).success).toBe(
        false,
      );
    },
  );

  it.each([null, [], {}, true, 123])(
    'rejects non-string cursors: %j',
    (cursor) => {
      expect(CursorPaginationQuerySchema.safeParse({ cursor }).success).toBe(
        false,
      );
    },
  );

  it('rejects invalid UTF-8 even inside otherwise valid JSON', () => {
    const bytes = Buffer.concat([
      Buffer.from('{"name":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
    expect(decodeCursor(bytes.toString('base64url'))).toBeUndefined();
  });

  it('rejects noncanonical base64 padding bits', () => {
    expect(decodeCursor('e31')).toBeUndefined(); // Decodes like canonical e30 ({}).
    expect(decodeCursor('e30')).toEqual({});
    expect(ExerciseCursorQuerySchema.safeParse({ cursor: 'e30' }).success).toBe(
      false,
    );
  });

  it.each([
    null,
    [],
    {},
    { ...payload, normalizedName: '' },
    { ...payload, normalizedName: 'x'.repeat(601) },
  ])('rejects valid JSON with an invalid cursor shape: %j', (value) => {
    expect(
      ExerciseCursorQuerySchema.safeParse({ cursor: encodeCursor(value) })
        .success,
    ).toBe(false);
  });
});
