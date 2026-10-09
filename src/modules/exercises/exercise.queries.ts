const exerciseSelection = `
  SELECT e.id, e.name, e.normalized_name AS "normalizedName",
    COALESCE(array_agg(mg.name ORDER BY mg.name COLLATE "C")
      FILTER (WHERE mg.id IS NOT NULL), ARRAY[]::varchar[]) AS "muscleGroups"
  FROM exercises e
  LEFT JOIN exercise_muscle_groups emg ON emg.exercise_id = e.id
  LEFT JOIN muscle_groups mg ON mg.id = emg.muscle_group_id`;

export const LIST_EXERCISES_SQL = `${exerciseSelection}
  GROUP BY e.id ORDER BY e.normalized_name COLLATE "C", e.id`;

export const RESOLVE_EXERCISES_SQL = `${exerciseSelection}
  WHERE e.normalized_name = ANY($1::text[]) GROUP BY e.id`;
