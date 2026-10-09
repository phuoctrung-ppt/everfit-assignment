import type { INestApplication } from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
import { createApplication } from '../src/bootstrap';
import {
  createWorkoutFixture,
  postWorkout,
  workout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('ten concurrent clients across two PostgreSQL-backed apps', () => {
  let fixture: WorkoutFixture;
  let peer: INestApplication;
  beforeAll(async () => {
    fixture = await createWorkoutFixture();
    process.env.DB_LOCK_TIMEOUT_MS = '2000';
    process.env.DB_STATEMENT_TIMEOUT_MS = '5000';
    await fixture.restart();
    peer = await createApplication();
    await peer.init();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => {
    await peer?.close();
    await fixture?.close();
  });
  const appFor = (index: number) => (index % 2 ? peer : fixture.app);

  it('commits one batch and replays it to all ten clients and a fresh app', async () => {
    const body = { entries: [workout, workout] };
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        postWorkout(appFor(index), 'shared', body, 'logging-user', true).expect(
          201,
        ),
      ),
    );
    for (const response of responses)
      expect(response.body).toEqual(responses[0]!.body);
    await fixture.restart();
    const replay = await postWorkout(
      fixture.app,
      'shared',
      body,
      'logging-user',
      true,
    ).expect(201);
    expect(replay.body).toEqual(responses[0]!.body);
    expect(await fixture.counts()).toEqual({
      entries: 2,
      sets: 4,
      requests: 1,
    });
  });

  it('retains all ten identical workouts when their keys differ', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        postWorkout(appFor(index), `distinct-${index}`).expect(201),
      ),
    );
    expect(new Set(responses.map(({ body }) => body.data.id)).size).toBe(10);
    expect(await fixture.counts()).toEqual({
      entries: 10,
      sets: 20,
      requests: 10,
    });
  });

  it('chooses one of ten different payloads and conflicts every other client', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        postWorkout(appFor(index), 'competing', {
          ...workout,
          sets: [{ reps: index + 1, weight: 10, unit: 'kg' }],
        }),
      ),
    );
    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    const conflicts = responses.filter(({ status }) => status === 409);
    expect(conflicts).toHaveLength(9);
    for (const response of conflicts)
      expect(response.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await fixture.counts()).toEqual({
      entries: 1,
      sets: 1,
      requests: 1,
    });
  });

  it('keeps unrelated keys independent during a real lock, then retries the timed-out key', async () => {
    const locker = await fixture.service.pool.connect();
    let blocked: Promise<unknown> | undefined;
    let finished = false;
    try {
      await locker.query('BEGIN');
      const pid = await locker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      await locker.query(
        'INSERT INTO idempotency_requests (user_id, key, fingerprint) VALUES ($1, $2, $3)',
        ['logging-user', 'locked', 'uncommitted'],
      );
      blocked = postWorkout(fixture.app, 'locked').then((response) => {
        finished = true;
        return response;
      });
      // Observe actual database contention before exercising independent keys.
      let waiting = false;
      const deadline = Date.now() + 1500;
      while (!waiting && Date.now() < deadline) {
        const result = await locker.query<{ waiting: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database()
           AND $1 = ANY(pg_blocking_pids(pid))) AS waiting`,
          [pid.rows[0]!.pid],
        );
        waiting = result.rows[0]!.waiting;
        if (!waiting) await setTimeout(5);
      }
      expect(waiting).toBe(true);
      await Promise.all([
        postWorkout(fixture.app, 'independent-local').expect(201),
        postWorkout(peer, 'independent-peer').expect(201),
        postWorkout(peer, 'locked', workout, 'another-user').expect(201),
      ]);
      expect(finished).toBe(false);
      const response = await blocked;
      expect(response).toMatchObject({
        status: 503,
        body: {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service unavailable',
            details: [],
          },
        },
      });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
      await blocked;
    }
    expect(await fixture.counts()).toEqual({
      entries: 3,
      sets: 6,
      requests: 3,
    });
    const first = await postWorkout(peer, 'locked').expect(201);
    const replay = await postWorkout(fixture.app, 'locked').expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await fixture.counts()).toEqual({
      entries: 4,
      sets: 8,
      requests: 4,
    });
  });
});
