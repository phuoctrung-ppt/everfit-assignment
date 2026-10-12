import type { WorkoutEntry } from '../../src/schemas/workout-response.schema';
import type { CreateWorkoutDto } from '../../src/schemas/workout.schema';

export interface PersistenceCase {
  input: CreateWorkoutDto;
  exercise: WorkoutEntry['exercise'];
}

// Deliberately not chronological or grouped by exercise; set counts also vary.
export const persistenceCases: PersistenceCase[] = [
  {
    input: {
      date: '2026-03-01T00:00:00.001Z',
      exerciseName: ' sQUat ',
      sets: [
        { reps: 3, weight: 123.456789, unit: 'lb' },
        { reps: 17, weight: 0.000001, unit: 'kg' },
        { reps: 1, weight: 999999.999999, unit: 'lb' },
      ],
    },
    exercise: {
      id: '10000000-0000-4000-8000-000000000002',
      name: 'Squat',
      muscleGroups: ['glutes', 'quadriceps'],
    },
  },
  {
    input: {
      date: '2024-02-29T23:59:59.999Z',
      exerciseName: 'Deadlift',
      sets: [{ reps: 10000, weight: 0.000001, unit: 'lb' }],
    },
    exercise: {
      id: '10000000-0000-4000-8000-000000000003',
      name: 'Deadlift',
      muscleGroups: ['glutes', 'hamstrings'],
    },
  },
  {
    input: {
      date: '2025-12-31T08:09:10.456Z',
      exerciseName: 'Bench Press',
      sets: [
        { reps: 12, weight: 1.23455, unit: 'kg' },
        { reps: 8, weight: 1.234549, unit: 'kg' },
      ],
    },
    exercise: {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Bench Press',
      muscleGroups: ['chest', 'triceps'],
    },
  },
  {
    input: {
      date: '2026-01-15T12:30:45.007Z',
      exerciseName: 'Push Up',
      sets: [
        { reps: 41, weight: 0, unit: 'lb' },
        { reps: 2, weight: 1000000, unit: 'kg' },
      ],
    },
    exercise: {
      id: '10000000-0000-4000-8000-000000000004',
      name: 'Push Up',
      muscleGroups: ['chest', 'triceps'],
    },
  },
];
