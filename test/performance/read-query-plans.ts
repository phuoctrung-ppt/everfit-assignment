import type { DatabaseService } from '../../src/database/database.service';
import { HistoryQuerySchema } from '../../src/schemas/history-query.schema';
import { historyFilterDigest } from '../../src/modules/workouts/history-cursor';
import { WorkoutHistoryRepository } from '../../src/modules/workouts/workout-history.repository';
import { PersonalRecordsRepository } from '../../src/modules/personal-records/personal-records.repository';
import type { RecordRange } from '../../src/modules/personal-records/personal-records.types';
import type { ReadScenario } from './read-scenarios';

export async function readQueryPlans(
  database: DatabaseService,
  scenario: ReadScenario,
) {
  const statements: { sql: string; parameters: unknown[] }[] = [];
  // Observe the real repository statements and execute them against PostgreSQL.
  // No duplicated benchmark SQL and no mocked database responses.
  const pool = new Proxy(database.pool, {
    get(target, property) {
      if (property === 'query')
        return async (sql: string, parameters: unknown[]) => {
          statements.push({ sql, parameters });
          return target.query(sql, parameters);
        };
      return Reflect.get(target, property);
    },
  });
  const observed = new Proxy(database, {
    get(target, property) {
      return property === 'pool' ? pool : Reflect.get(target, property);
    },
  });
  const query = scenario.query;
  if (scenario.route === 'workout-entries') {
    const parsed = HistoryQuerySchema.parse(query);
    await new WorkoutHistoryRepository(observed).findPage(
      scenario.userId,
      parsed,
      scenario.after
        ? {
            version: 1,
            ...scenario.after,
            filterDigest: historyFilterDigest(scenario.userId, parsed),
          }
        : null,
    );
  } else {
    const ranges: RecordRange[] = scenario.route.endsWith('/compare')
      ? [
          {
            period: 'baseline',
            from: query.baselineFrom,
            to: query.baselineTo,
          },
          {
            period: 'comparison',
            from: query.comparisonFrom,
            to: query.comparisonTo,
          },
        ]
      : [{ period: 'current', from: query.from, to: query.to }];
    await new PersonalRecordsRepository(observed).selectWinners(
      scenario.userId,
      '10000000-0000-4000-8000-000000000001',
      ranges,
    );
  }
  const plans = [];
  for (const statement of statements) {
    const result = await database.pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
      statement.parameters,
    );
    plans.push({
      ...statement,
      explain: result.rows[0]['QUERY PLAN'] as unknown,
    });
  }
  return { scenario: scenario.name, statements: plans };
}
