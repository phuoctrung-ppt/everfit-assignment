import { ZodValidationException } from 'nestjs-zod';
import request from 'supertest';
import { ZodError } from 'zod';
import { WorkoutLoggingService } from '../src/modules/workouts/workout-logging.service';
import { comparisonQuery } from './support/record-fixtures';
import {
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('safe validation reasons over HTTP', () => {
  let fixture: WorkoutFixture;
  const entriesPath = '/users/logging-user/workout-entries';
  const recordsPath = '/users/logging-user/personal-records';
  const malicious = '<script>private-payload</script>';
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
  });
  afterAll(async () => fixture?.close());

  function expectDetails(
    response: request.Response,
    path: string,
    message: string,
  ) {
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: [{ path, message }],
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.text).not.toContain(malicious);
  }

  it('explains unknown exercises in single, bulk and PR requests without echoing names', async () => {
    const body = { ...workout, exerciseName: malicious };
    const single = await postWorkout(fixture.app, 'unknown', body).expect(400);
    expectDetails(single, 'exerciseName', 'Unknown exercise');
    const bulk = await postWorkout(
      fixture.app,
      'unknown-bulk',
      { entries: [workout, body] },
      'logging-user',
      true,
    ).expect(400);
    expectDetails(bulk, 'entries.1.exerciseName', 'Unknown exercise');
    for (const [path, query] of [
      [recordsPath, {}],
      [`${recordsPath}/compare`, comparisonQuery],
    ] as const) {
      const response = await request(fixture.app.getHttpServer())
        .get(path)
        .query({ ...query, exerciseName: malicious })
        .expect(400);
      expectDetails(response, 'exerciseName', 'Unknown exercise');
    }
  });

  it.each([
    [
      entriesPath,
      { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
      'to',
    ],
    [
      recordsPath,
      { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
      'to',
    ],
    [
      `${recordsPath}/compare`,
      { ...comparisonQuery, baselineTo: comparisonQuery.baselineFrom },
      'baselineTo',
    ],
    [
      `${recordsPath}/compare`,
      { ...comparisonQuery, comparisonTo: comparisonQuery.comparisonFrom },
      'comparisonTo',
    ],
  ])('explains invalid range for %s (%s)', async (path, query, field) => {
    const response = await request(fixture.app.getHttpServer())
      .get(path)
      .query({ exerciseName: 'Bench Press', ...query })
      .expect(400);
    expectDetails(response, field, 'End must be after start');
  });

  it('explains excessive weight precision', async () => {
    const response = await postWorkout(fixture.app, 'precision', {
      ...workout,
      sets: [{ reps: 1, weight: 0.0000001, unit: 'kg' }],
    }).expect(400);
    expectDetails(
      response,
      'sets.0.weight',
      'Weight must have at most six decimal places',
    );
  });

  it('explains the total set limit across otherwise valid entries', async () => {
    const entries = Array.from({ length: 11 }, () => ({
      ...workout,
      sets: Array.from({ length: 100 }, () => workout.sets[0]),
    }));
    const response = await postWorkout(
      fixture.app,
      'total-sets',
      { entries },
      'logging-user',
      true,
    ).expect(400);
    expectDetails(
      response,
      'entries',
      'A request must contain at most 1000 sets',
    );
  });

  it('keeps malicious unknown fields and unsupported units generic', async () => {
    for (const [body, path, message] of [
      [{ ...workout, [malicious]: true }, '', 'Unknown field'],
      [
        { ...workout, sets: [{ ...workout.sets[0], [malicious]: true }] },
        'sets.0',
        'Unknown field',
      ],
      [
        { ...workout, sets: [{ reps: 1, weight: 1, unit: malicious }] },
        'sets.0.unit',
        'Invalid value',
      ],
    ] as const) {
      const response = await postWorkout(fixture.app, 'untrusted', body).expect(
        400,
      );
      expectDetails(response, path, message);
    }
  });

  it.each([
    malicious,
    `Unknown exercise: ${malicious}`,
    'toString',
    '__proto__',
  ])('never forwards an unallowlisted custom message: %s', async (message) => {
    // Inject a future validator failure; exercise the real HTTP filter, not DB behavior.
    const log = jest
      .spyOn(fixture.app.get(WorkoutLoggingService), 'log')
      .mockRejectedValueOnce(
        new ZodValidationException(
          new ZodError([{ code: 'custom', path: ['exerciseName'], message }]),
        ),
      );
    try {
      const response = await postWorkout(fixture.app, 'custom').expect(400);
      expectDetails(response, 'exerciseName', 'Invalid value');
    } finally {
      log.mockRestore();
    }
  });

  it('preserves generic pagination messages for invalid limits and cursors', async () => {
    for (const path of ['/exercises', entriesPath]) {
      for (const [field, value] of [
        ['limit', '0'],
        ['cursor', 'e30'],
      ] as const) {
        const response = await request(fixture.app.getHttpServer())
          .get(path)
          .query({ [field]: value })
          .expect(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(response.body.error.details.length).toBeGreaterThan(0);
        for (const detail of response.body.error.details) {
          expect(detail.message).toBe('Invalid value');
          expect(
            detail.path === field || detail.path.startsWith(`${field}.`),
          ).toBe(true);
        }
      }
    }
  });
});
