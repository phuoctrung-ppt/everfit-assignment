import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { isTransientDatabaseError } from '../../database/database-errors';
import { DatabaseService } from '../../database/database.service';
import { applyImportBatch, failImport } from './import-batch';
import { stageImport } from './import-staging';

const retryableCodes = new Set(['40001', '40P01', '55P03', '57014']);
function retryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    retryableCodes.has(error.code)
  );
}

interface ImportStep {
  id: string;
  attempts: number;
}
interface LockedImport {
  user_id: string;
  status: string;
  source: Buffer | null;
}

@Injectable()
export class ImportWorkerService {
  constructor(private readonly database: DatabaseService) {}

  async run(signal?: AbortSignal): Promise<void> {
    const client = await this.database.pool.connect();
    let disconnected = false;
    let locked = false;
    // Checked-out clients are not covered by the pool's idle-error listener.
    const onDisconnect = () => {
      disconnected = true;
    };
    client.on('error', onDisconnect);
    client.on('end', onDisconnect);
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(74321, 1) AS locked',
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) throw new Error('Import worker already running');
      while (!signal?.aborted) {
        if (disconnected) throw new Error('Import worker connection lost');
        const jobs = await client.query<ImportStep>(
          `SELECT id, attempts FROM workout_imports
           WHERE status IN ('queued', 'running') AND next_attempt_at <= now()
           ORDER BY created_at, id LIMIT 1`,
        );
        const job = jobs.rows[0];
        if (signal?.aborted) break;
        if (!job) {
          await delay(100);
          continue;
        }
        if (job.attempts >= 3) {
          await failImport(client, job.id, new Error('Attempts exhausted'));
          continue;
        }
        // This survives rollback and process restarts, including a mid-step crash.
        await client.query(
          `UPDATE workout_imports SET attempts = attempts + 1, updated_at = now()
           WHERE id = $1`,
          [job.id],
        );
        job.attempts++;
        try {
          await this.step(client, job.id);
        } catch (error) {
          if (
            disconnected ||
            (!retryable(error) && isTransientDatabaseError(error))
          ) {
            throw error;
          }
          if (retryable(error) && job.attempts < 3) {
            await client.query(
              `UPDATE workout_imports SET retry_count = retry_count + 1,
                 next_attempt_at = now() + $2::double precision * interval '1 millisecond',
                 updated_at = now() WHERE id = $1`,
              [job.id, 100 * 2 ** (job.attempts - 1)],
            );
          } else {
            await failImport(client, job.id, error);
          }
        }
      }
      if (disconnected) throw new Error('Import worker connection lost');
    } finally {
      try {
        if (locked && !disconnected) {
          await client.query('SELECT pg_advisory_unlock(74321, 1)');
        }
      } finally {
        // This dedicated session is never reused; retain listeners for late errors.
        client.release(true);
      }
    }
  }

  private async step(client: PoolClient, importId: string): Promise<void> {
    await client.query('BEGIN');
    try {
      const result = await client.query<LockedImport>(
        `SELECT user_id, status, source FROM workout_imports WHERE id = $1 FOR UPDATE`,
        [importId],
      );
      const job = result.rows[0];
      if (!job) throw new Error('Missing import job');
      if (job.status === 'queued' && job.source) {
        await stageImport(client, importId, job.source);
      } else if (job.status === 'running') {
        await applyImportBatch(client, importId, job.user_id);
      } else {
        throw new Error('Invalid import state');
      }
      await client.query('COMMIT');
    } catch (error) {
      // Failed rollback is fatal: never write job metadata on a broken session.
      try {
        await client.query('ROLLBACK');
      } catch {
        throw Object.assign(new Error('Import worker connection lost'), {
          code: '08006',
        });
      }
      throw error;
    }
  }
}
