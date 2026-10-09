import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isTransientDatabaseError } from '../../database/database-errors';
import type { HistoryQuery } from '../../schemas/history-query.schema';
import {
  EMPTY_HISTORY_MESSAGE,
  type HistoryResponse,
} from '../../schemas/history-response.schema';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyFilterDigest,
} from './history-cursor';
import type { HistorySetRow } from './history.types';
import { WorkoutHistoryRepository } from './workout-history.repository';
import { mapWorkoutEntry } from './workout-response.mapper';

@Injectable()
export class WorkoutHistoryService {
  constructor(private readonly history: WorkoutHistoryRepository) {}

  async list(userId: string, query: HistoryQuery): Promise<HistoryResponse> {
    const filterDigest = historyFilterDigest(userId, query);
    const after = query.cursor
      ? decodeHistoryCursor(query.cursor, filterDigest)
      : null;
    try {
      const rows = await this.history.findPage(userId, query, after);
      const hasMore = rows.entries.length > query.limit;
      const entries = rows.entries.slice(0, query.limit);
      const setsByEntry = new Map<string, HistorySetRow[]>();
      for (const set of rows.sets) {
        const sets = setsByEntry.get(set.entry_id) ?? [];
        sets.push(set);
        setsByEntry.set(set.entry_id, sets);
      }
      const last = entries.at(-1);
      return {
        data: entries.map((entry) =>
          mapWorkoutEntry(
            entry,
            {
              id: entry.exercise_id,
              name: entry.exercise_name,
              normalizedName: entry.normalized_name,
              muscleGroups: entry.muscle_groups,
            },
            setsByEntry.get(entry.id) ?? [],
            query.unit,
          ),
        ),
        pagination: {
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeHistoryCursor({
                  version: 1,
                  date: last.performed_at.toISOString(),
                  id: last.id,
                  filterDigest,
                })
              : null,
        },
        message: entries.length ? null : EMPTY_HISTORY_MESSAGE,
      };
    } catch (error) {
      if (isTransientDatabaseError(error))
        throw new ServiceUnavailableException();
      throw error;
    }
  }
}
