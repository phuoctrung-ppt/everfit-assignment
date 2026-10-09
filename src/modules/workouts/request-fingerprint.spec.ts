import { requestFingerprint } from './request-fingerprint';
import type { CreateWorkoutDto } from '../../schemas/workout.schema';

describe('versioned request fingerprints', () => {
  const body: CreateWorkoutDto = {
    date: '2026-10-09T00:00:00Z',
    exerciseName: 'Bench Press',
    sets: [
      { reps: 5, weight: 135, unit: 'lb' },
      { reps: 8, weight: 60, unit: 'kg' },
    ],
  };
  const hash = requestFingerprint('user-1', 'single', body);

  it('ignores object key order and JSON number formatting', () => {
    const reordered = {
      sets: body.sets.map(({ unit, weight, reps }) => ({ unit, weight, reps })),
      exerciseName: body.exerciseName,
      date: body.date,
    };
    expect(requestFingerprint('user-1', 'single', reordered)).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const formatted = JSON.parse(JSON.stringify(body).replace('135', '135.0'));
    expect(requestFingerprint('user-1', 'single', formatted)).toBe(hash);
  });

  it.each([
    { ...body, exerciseName: 'bench press' },
    { ...body, exerciseName: ' Bench Press ' },
    { ...body, sets: [...body.sets].reverse() },
    { ...body, sets: [{ reps: 5, weight: 136, unit: 'lb' as const }] },
    { ...body, sets: [{ reps: 5, weight: 135, unit: 'kg' as const }] },
    { ...body, sets: [{ reps: 6, weight: 135, unit: 'lb' as const }] },
  ])('preserves body values and set order (%j)', (changed) => {
    expect(requestFingerprint('user-1', 'single', changed)).not.toBe(hash);
  });

  it('binds the user and operation and preserves bulk entry order', () => {
    expect(requestFingerprint('user-2', 'single', body)).not.toBe(hash);
    expect(requestFingerprint('user-1', 'bulk', { entries: [body] })).not.toBe(
      hash,
    );
    const other = { ...body, exerciseName: 'Squat' };
    expect(
      requestFingerprint('user-1', 'bulk', { entries: [body, other] }),
    ).not.toBe(
      requestFingerprint('user-1', 'bulk', { entries: [other, body] }),
    );
  });
});
