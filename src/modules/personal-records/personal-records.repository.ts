import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { RecordRange, RecordWinnerRow } from './personal-records.types';

// Both periods and all metrics are evaluated by one statement/MVCC snapshot.
// Top-one sorts avoid ranking every metric-expanded candidate. The JSON array
// length also exposes the real period count to the planner (recordset defaults to 100).
export const SELECT_RECORD_WINNERS_SQL = `
  WITH ranges AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset($3::jsonb)
      AS r(period text, "from" timestamptz, "to" timestamptz)
    LIMIT jsonb_array_length($3::jsonb)
  ), candidates AS MATERIALIZED (
    SELECT r.period, e.id AS entry_id, e.performed_at AS achieved_at,
           s.position AS set_position, s.reps, s.weight_kg
    FROM ranges r
    JOIN workout_entries e ON e.user_id = $1 AND e.exercise_id = $2::uuid
      AND (r."from" IS NULL OR e.performed_at >= r."from")
      AND (r."to" IS NULL OR e.performed_at < r."to")
    JOIN workout_sets s ON s.entry_id = e.id
  )
  SELECT r.period, m.metric, winner.weight_kg::text, winner.reps,
         winner.achieved_at, winner.entry_id, winner.set_position,
         (CASE WHEN m.metric = 'estimatedOneRepMax' THEN winner.rank_value / 30
               ELSE winner.rank_value END)::text AS canonical_value
  FROM ranges r
  CROSS JOIN (VALUES ('heaviestSet'), ('highestVolumeSet'), ('estimatedOneRepMax')) AS m(metric)
  CROSS JOIN LATERAL (
    SELECT c.*, CASE m.metric
      WHEN 'heaviestSet' THEN c.weight_kg
      WHEN 'highestVolumeSet' THEN c.weight_kg * c.reps
      ELSE c.weight_kg * (30 + c.reps) END AS rank_value
    FROM candidates c WHERE c.period = r.period
    ORDER BY rank_value DESC, c.achieved_at ASC, c.entry_id ASC, c.set_position ASC
    LIMIT 1
  ) AS winner`;

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
