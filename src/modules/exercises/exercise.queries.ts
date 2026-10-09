const exerciseSelection = `
  SELECT e.id, e.name, e.normalized_name AS "normalizedName",
    COALESCE(array_agg(mg.name ORDER BY mg.name COLLATE "C")
      FILTER (WHERE mg.id IS NOT NULL), ARRAY[]::varchar[]) AS "muscleGroups"
  FROM exercises e
  LEFT JOIN exercise_muscle_groups emg ON emg.exercise_id = e.id
  LEFT JOIN muscle_groups mg ON mg.id = emg.muscle_group_id`;

// Bound exercise rows before expanding their many-to-many muscle-group mappings.
export const LIST_EXERCISES_SQL = `WITH page AS (
  SELECT id, name, normalized_name FROM exercises
  WHERE ($1::text IS NULL
    OR (normalized_name COLLATE "C", id) > ($1::text COLLATE "C", $2::uuid))
    AND ($4::text IS NULL OR EXISTS (
      SELECT 1 FROM exercise_muscle_groups filter_mapping
      JOIN muscle_groups filter_group ON filter_group.id = filter_mapping.muscle_group_id
      WHERE filter_mapping.exercise_id = exercises.id AND filter_group.name = $4::text
    ))
  ORDER BY normalized_name COLLATE "C", id LIMIT $3
)
  SELECT e.id, e.name, e.normalized_name AS "normalizedName",
    COALESCE(array_agg(mg.name ORDER BY mg.name COLLATE "C")
      FILTER (WHERE mg.id IS NOT NULL), ARRAY[]::varchar[]) AS "muscleGroups"
  FROM page e
  LEFT JOIN exercise_muscle_groups emg ON emg.exercise_id = e.id
  LEFT JOIN muscle_groups mg ON mg.id = emg.muscle_group_id
  GROUP BY e.id, e.name, e.normalized_name
  ORDER BY e.normalized_name COLLATE "C", e.id`;

export const RESOLVE_EXERCISES_SQL = `${exerciseSelection}
  WHERE e.normalized_name = ANY($1::text[]) GROUP BY e.id`;
