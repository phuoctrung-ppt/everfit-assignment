import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { RecordRange, RecordWinnerRow } from './personal-records.types';

// Both periods and all metrics are evaluated by one statement/MVCC snapshot.
export const SELECT_RECORD_WINNERS_SQL = `
  WITH candidates AS (
    SELECT r.period, e.id AS entry_id, e.performed_at AS achieved_at,
           s.position AS set_position, s.reps, s.weight_kg,
           m.metric, m.rank_value,
           row_number() OVER (
             PARTITION BY r.period, m.metric
             ORDER BY m.rank_value DESC, e.performed_at ASC, e.id ASC, s.position ASC
           ) AS rank
    FROM jsonb_to_recordset($3::jsonb) AS r(period text, "from" timestamptz, "to" timestamptz)
    JOIN workout_entries e ON e.user_id = $1 AND e.exercise_id = $2::uuid
      AND (r."from" IS NULL OR e.performed_at >= r."from")
      AND (r."to" IS NULL OR e.performed_at < r."to")
    JOIN workout_sets s ON s.entry_id = e.id
    CROSS JOIN LATERAL (VALUES
      ('heaviestSet', s.weight_kg),
      ('highestVolumeSet', s.weight_kg * s.reps),
      ('estimatedOneRepMax', s.weight_kg * (30 + s.reps))
    ) AS m(metric, rank_value)
  )
  SELECT period, metric, weight_kg::text, reps, achieved_at, entry_id, set_position,
         (CASE WHEN metric = 'estimatedOneRepMax' THEN rank_value / 30
               ELSE rank_value END)::text AS canonical_value
  FROM candidates WHERE rank = 1`;

@Injectable()
export class PersonalRecordsRepository {
  constructor(private readonly database: DatabaseService) {}

  async selectWinners(
    userId: string,
    exerciseId: string,
    ranges: RecordRange[],
  ): Promise<RecordWinnerRow[]> {
    const result = await this.database.pool.query<RecordWinnerRow>(
      SELECT_RECORD_WINNERS_SQL,
      [userId, exerciseId, JSON.stringify(ranges)],
    );
    return result.rows;
  }
}
