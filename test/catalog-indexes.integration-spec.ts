import { Client } from 'pg';
import { createTestDatabase } from './support/test-database';

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

  it('uses the existing unique name index for selective exact-name resolution', async () => {
    const result = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id FROM exercises WHERE normalized_name = ANY($1::text[])`,
      [['exercise 4321']],
    );
    const plan = JSON.stringify(result.rows[0]['QUERY PLAN']);
    expect(plan).toContain('exercises_normalized_name_key');
    expect(plan).toContain('"Actual Rows":1');
  });

  it('uses the existing reverse mapping index for selective muscle-group lookup', async () => {
    const result = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT exercise_id FROM exercise_muscle_groups WHERE muscle_group_id = md5($1)::uuid`,
      ['group-43'],
    );
    const plan = JSON.stringify(result.rows[0]['QUERY PLAN']);
    expect(plan).toContain('exercise_muscle_groups_reverse_idx');
    expect(plan).toContain('"Actual Rows":100');
  });
});
