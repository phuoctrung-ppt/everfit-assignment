import { entryIds, getHistory, logHistory } from './support/history-fixtures';
import {
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('workout history keyset pagination against PostgreSQL', () => {
  let fixture: WorkoutFixture;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => fixture?.close());

  it('traverses tied timestamps in descending ID order with all sets and changing limits', async () => {
    const entries = [];
    for (let i = 0; i < 5; i++)
      entries.push(await logHistory(fixture, `tie-${i}`));
    const newest = await logHistory(fixture, 'newest', {
      date: '2026-02-01T00:00:00Z',
    });
    const oldest = await logHistory(fixture, 'oldest', {
      date: '2025-12-01T00:00:00Z',
    });
    await logHistory(fixture, 'foreign', {}, 'other-user');
    const expected = [
      newest,
      ...entries.sort((a, b) => b.id.localeCompare(a.id)),
      oldest,
    ];
    const seen: string[] = [];
    let cursor: string | undefined;
    for (const limit of [2, 3, 2]) {
      const result = await getHistory(fixture, {
        limit,
        ...(cursor ? { cursor } : {}),
      }).expect(200);
      expect(result.body.data).toEqual(
        expected.slice(seen.length, seen.length + limit),
      );
      seen.push(...entryIds(result.body));
      expect(result.body.pagination.hasMore).toBe(
        seen.length < expected.length,
      );
      cursor = result.body.pagination.nextCursor;
      if (seen.length < expected.length)
        expect(cursor).toEqual(expect.any(String));
      else expect(cursor).toBeNull();
    }
    expect(seen).toEqual(expected.map((entry) => entry.id));
    expect(new Set(seen).size).toBe(expected.length);
  });

  it('binds cursors to the user and every normalized filter, excluding page size', async () => {
    for (let i = 0; i < 3; i++) await logHistory(fixture, `binding-${i}`);
    const filters = {
      exerciseName: 'bench',
      muscleGroup: 'chest',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      unit: 'kg',
    };
    const first = await getHistory(fixture, { ...filters, limit: 1 }).expect(
      200,
    );
    const cursor = first.body.pagination.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    const equivalent = await getHistory(fixture, {
      ...filters,
      exerciseName: ' BENCH ',
      muscleGroup: ' CHEST ',
      limit: 2,
      cursor,
    }).expect(200);
    expect(equivalent.body.data).toHaveLength(2);
    for (const change of [
      { exerciseName: 'squat' },
      { muscleGroup: 'triceps' },
      { unit: 'lb' },
      { from: '2025-01-01T00:00:00Z' },
      { to: '2027-01-01T00:00:00Z' },
    ]) {
      const result = await getHistory(fixture, {
        ...filters,
        ...change,
        cursor,
      }).expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    }
    await getHistory(fixture, { cursor }).expect(400);
    await getHistory(fixture, { ...filters, cursor }, 'other-user').expect(400);
  });

  it('allows implicit defaults to become explicit without invalidating the cursor', async () => {
    await logHistory(fixture, 'first');
    await logHistory(fixture, 'second');
    const first = await getHistory(fixture, { limit: 1 }).expect(200);
    const next = await getHistory(fixture, {
      cursor: first.body.pagination.nextCursor as string,
      unit: 'kg',
      limit: 100,
    }).expect(200);
    expect(next.body.data).toHaveLength(1);
    expect(entryIds(next.body)).not.toEqual(entryIds(first.body));
  });

  it('includes backdated inserts later and newer inserts on refresh without repeating rows', async () => {
    const latest = await logHistory(fixture, 'latest', {
      date: '2026-03-01T00:00:00Z',
    });
    const oldest = await logHistory(fixture, 'oldest', {
      date: '2026-01-01T00:00:00Z',
    });
    const first = await getHistory(fixture, { limit: 1 }).expect(200);
    expect(entryIds(first.body)).toEqual([latest.id]);
    const [newer, backdated] = await Promise.all([
      logHistory(fixture, 'newer', { date: '2026-04-01T00:00:00Z' }),
      logHistory(fixture, 'backdated', { date: '2026-02-01T00:00:00Z' }),
    ]);
    const next = await getHistory(fixture, {
      cursor: first.body.pagination.nextCursor as string,
    }).expect(200);
    expect(entryIds(next.body)).toEqual([backdated.id, oldest.id]);
    expect(next.body.pagination).toEqual({ nextCursor: null, hasMore: false });
    expect(entryIds((await getHistory(fixture).expect(200)).body)).toEqual([
      newer.id,
      latest.id,
      backdated.id,
      oldest.id,
    ]);
  });

  it('defaults to 20 entries and supports the maximum of 100 complete entries', async () => {
    for (const count of [100, 5]) {
      await postWorkout(
        fixture.app,
        `bulk-${count}`,
        {
          entries: Array.from({ length: count }, () => workout),
        },
        'history-user',
        true,
      ).expect(201);
    }
    const first = await getHistory(fixture).expect(200);
    expect(first.body.data).toHaveLength(20);
    expect(first.body.pagination.hasMore).toBe(true);
    const max = await getHistory(fixture, { limit: 100 }).expect(200);
    expect(max.body.data).toHaveLength(100);
    expect(max.body.pagination.hasMore).toBe(true);
    for (const entry of max.body.data) expect(entry.sets).toHaveLength(2);
    const final = await getHistory(fixture, {
      limit: 100,
      cursor: max.body.pagination.nextCursor as string,
    }).expect(200);
    expect(final.body.data).toHaveLength(5);
    expect(final.body.pagination).toEqual({ nextCursor: null, hasMore: false });
    expect(new Set([...entryIds(max.body), ...entryIds(final.body)]).size).toBe(
      105,
    );
  });
});
