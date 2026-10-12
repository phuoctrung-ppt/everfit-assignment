import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { createApplication } from '../src/bootstrap';
import { createPerformanceDatabase } from './performance/database-fixture';
import {
  runBatchRetryWorkload,
  BATCH_USER,
  type BatchRetryProgress,
} from './performance/batch-retry-workload';

describe('batch recovery and retained PostgreSQL data', () => {
  let database: Awaited<ReturnType<typeof createPerformanceDatabase>>;
  let app: INestApplication;
  const previousEnvironment = { ...process.env };
  beforeAll(async () => {
    database = await createPerformanceDatabase();
    Object.assign(process.env, {
      DATABASE_URL: database.databaseUrl,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await database?.close();
      } finally {
        process.env = previousEnvironment;
      }
    }
  });

  it('preserves completed HTTP attempts when a rollback verification fails', async () => {
    const progress: BatchRetryProgress = {
      attempts: [],
      recovery: [],
      batchLatenciesMs: [],
    };
    const unavailable = {
      ...database,
      verify: async () => {
        throw new Error('Inspection failed');
      },
    };
    try {
      await expect(
        runBatchRetryWorkload(
          await app.getUrl(),
          unavailable,
          3,
          undefined,
          progress,
        ),
      ).rejects.toThrow('Inspection failed');
      expect(progress.attempts.map(({ status }) => status)).toEqual([201, 400]);
      expect(progress.batchLatenciesMs).toHaveLength(1);
    } finally {
      const cleanup = new Client({ connectionString: database.databaseUrl });
      try {
        await cleanup.connect();
        await cleanup.query(
          'TRUNCATE workout_sets, workout_entries, idempotency_requests',
        );
      } finally {
        await cleanup.end();
      }
    }
  });

  it('retries actual record failures atomically and retains data after closing processes/pools', async () => {
    const result = await runBatchRetryWorkload(await app.getUrl(), database, 3);
    expect(result.attempts.map(({ status }) => status)).toEqual([
      201, 400, 201, 503, 201,
    ]);
    const rollback = result.recovery.find(
      ({ kind }) => kind === 'transient-rollback',
    );
    expect(rollback).toMatchObject({
      attempts: 1,
      entriesSeenBeforeRollback: 300,
      afterRollback: { [BATCH_USER]: { entries: 200, sets: 600, requests: 2 } },
      persistenceAfterRollback: { entries: 200, sets: 600 },
    });
    expect(rollback?.setsSeenBeforeRollback).toBeGreaterThan(600);
    expect(await database.verifyPersistence(result.load.persistence)).toEqual({
      entries: 300,
      sets: 900,
    });
    await app.close();
    await database.close(true);
    const observer = new Client({ connectionString: database.databaseUrl });
    try {
      await observer.connect();
      const counts = await observer.query(`SELECT
        (SELECT count(*)::int FROM workout_entries) AS entries,
        (SELECT count(*)::int FROM workout_sets) AS sets,
        (SELECT count(*)::int FROM idempotency_requests) AS requests`);
      expect(counts.rows).toEqual([{ entries: 300, sets: 900, requests: 3 }]);
      const fault =
        await observer.query(`SELECT count(*)::int AS count FROM pg_trigger
        WHERE tgname = 'benchmark_record_failure'`);
      expect(fault.rows).toEqual([{ count: 0 }]);
    } finally {
      await observer.end();
    }
    // afterAll explicitly calls close(false) to drop this test's retained database.
  });
});
