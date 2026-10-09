import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { LoggingResultSchema } from '../../schemas/workout-logging.schema';
import type { LoggingResult, StoredIdempotencyResult } from './logging.types';

@Injectable()
export class IdempotencyRepository {
  async reserve(
    client: PoolClient,
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO idempotency_requests (user_id, key, fingerprint)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
      [userId, key, fingerprint],
    );
    return result.rowCount === 1;
  }

  async find(
    client: PoolClient,
    userId: string,
    key: string,
  ): Promise<StoredIdempotencyResult> {
    // Separate statement sees the winner after ON CONFLICT waited for its commit.
    const result = await client.query<{
      fingerprint: string;
      response_status: unknown;
      response_body: unknown;
    }>(
      `SELECT fingerprint, response_status, response_body FROM idempotency_requests
       WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Idempotency reservation missing');
    return {
      fingerprint: row.fingerprint,
      result: LoggingResultSchema.parse({
        status: row.response_status,
        body: row.response_body,
      }),
    };
  }

  async complete(
    client: PoolClient,
    userId: string,
    key: string,
    result: LoggingResult,
  ): Promise<void> {
    const validated = LoggingResultSchema.parse(result);
    const update = await client.query(
      `UPDATE idempotency_requests SET response_status = $3, response_body = $4::jsonb
       WHERE user_id = $1 AND key = $2 AND response_status IS NULL`,
      [userId, key, validated.status, JSON.stringify(validated.body)],
    );
    if (update.rowCount !== 1) throw new Error('Idempotency completion failed');
  }
}
