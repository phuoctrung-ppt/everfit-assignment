import { Client } from 'pg';
import {
  LIST_EXERCISES_SQL,
  RESOLVE_EXERCISES_SQL,
} from '../src/modules/exercises/exercise.queries';
import { createTestDatabase } from './support/test-database';

interface ExplainRow {
  'QUERY PLAN': [{ Plan: { 'Actual Rows': number } }];
}

describe('catalog index query plans', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  beforeAll(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.databaseUrl });
    await client.connect();
    await client.query(`INSERT INTO exercises (id, name, normalized_name)
      SELECT md5('exercise-' || i)::uuid, 'Exercise ' || i, 'exercise ' || i
      FROM generate_series(1, 10000) AS i`);
    await client.query(`INSERT INTO muscle_groups (id, name)
      SELECT md5('group-' || i)::uuid, 'group ' || i FROM generate_series(1, 100) AS i`);
    await client.query(`INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id)
      SELECT md5('exercise-' || i)::uuid, md5('group-' || (1 + i % 100))::uuid
      FROM generate_series(1, 10000) AS i`);
    await client.query(
      'ANALYZE exercises, muscle_groups, exercise_muscle_groups',
    );
  });
  afterAll(async () => {
    await client?.end();
    await database?.close();
  });

  it.each([
    { names: ['exercise 4321'], count: 1 },
    { names: ['exercise 4321', 'exercise 7654', 'exercise 9999'], count: 3 },
  ])(
    'uses the name index for the full $count-name resolution query',
    async ({ names, count }) => {
      const result = await client.query<ExplainRow>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${RESOLVE_EXERCISES_SQL}`,
        [names],
      );
      const plan = result.rows[0]?.['QUERY PLAN'][0].Plan;
      expect(JSON.stringify(plan)).toContain('exercises_normalized_name_key');
      expect(plan?.['Actual Rows']).toBe(count);
    },
  );

  it.each([
    [null, null, 21],
    ['exercise 9000', '00000000-0000-0000-0000-000000000000', 21],
  ])(
    'uses the cursor index and bounds joined rows after %s',
    async (name, id, limit) => {
      const result = await client.query<ExplainRow>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${LIST_EXERCISES_SQL}`,
        [name, id, limit, null],
      );
      const plan = result.rows[0]?.['QUERY PLAN'][0].Plan;
      expect(plan?.['Actual Rows']).toBe(21);
      expect(JSON.stringify(plan)).toContain('exercises_cursor_idx');
      if (name) expect(JSON.stringify(plan)).toContain('Index Cond');
    },
  );

  it('uses the existing reverse mapping index for selective muscle-group lookup', async () => {
    const result = await client.query<ExplainRow>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT exercise_id FROM exercise_muscle_groups WHERE muscle_group_id = md5($1)::uuid`,
      ['group-43'],
    );
    const plan = result.rows[0]?.['QUERY PLAN'][0].Plan;
    expect(JSON.stringify(plan)).toContain(
      'exercise_muscle_groups_reverse_idx',
    );
    expect(plan?.['Actual Rows']).toBe(100);
  });
});
