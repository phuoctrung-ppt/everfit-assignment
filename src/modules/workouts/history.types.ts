import type { StoredWorkoutEntry, StoredWorkoutSet } from './logging.types';

export interface HistoryEntryRow extends StoredWorkoutEntry {
  exercise_id: string;
  exercise_name: string;
  normalized_name: string;
  muscle_groups: string[];
}
export type HistorySetRow = StoredWorkoutSet;
export interface HistoryPageRows {
  entries: HistoryEntryRow[];
  sets: HistorySetRow[];
}
