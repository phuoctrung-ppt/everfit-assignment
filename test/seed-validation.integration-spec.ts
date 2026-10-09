import { Test } from '@nestjs/testing';
import { seedExerciseCatalog } from '../scripts/seed-exercise-catalog';
import { DatabaseService } from '../src/database/database.service';

describe('catalog seed validation boundary', () => {
  it.each(['exercises', 'muscleGroups'] as const)(
    'rejects case-variant %s UUIDs before opening a transaction',
    async (key) => {
      const withTransaction = jest.fn();
      const module = await Test.createTestingModule({
        providers: [
          { provide: DatabaseService, useValue: { withTransaction } },
        ],
      }).compile();
      const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      const input = {
        muscleGroups: [{ id, name: 'chest' }],
        exercises: [{ id, name: 'Bench Press', muscleGroups: ['chest'] }],
      };
      if (key === 'exercises') {
        input.exercises.push({
          id: id.toUpperCase(),
          name: 'Push Up',
          muscleGroups: [],
        });
      } else {
        input.muscleGroups.push({ id: id.toUpperCase(), name: 'triceps' });
      }
      try {
        await expect(
          seedExerciseCatalog(module.get(DatabaseService), input),
        ).rejects.toThrow('Duplicate catalog values');
        expect(withTransaction).not.toHaveBeenCalled();
      } finally {
        await module.close();
      }
    },
  );
});
