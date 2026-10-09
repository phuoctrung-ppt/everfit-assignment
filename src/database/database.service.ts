import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import type { Environment } from '../schemas/environment.schema';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(config: ConfigService<Environment, true>) {
    this.pool = new Pool({
      connectionString: config.getOrThrow('DATABASE_URL', { infer: true }),
      max: config.getOrThrow('DB_POOL_MAX', { infer: true }),
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      statement_timeout: config.getOrThrow('DB_STATEMENT_TIMEOUT_MS', {
        infer: true,
      }),
      lock_timeout: config.getOrThrow('DB_LOCK_TIMEOUT_MS', { infer: true }),
      options: '-c timezone=UTC',
    });
    // An idle connection can fail independently of a request. Never log raw DB errors.
    this.pool.on('error', () =>
      this.logger.error('Idle database connection failed'),
    );
  }

  async withTransaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    const onClientError = () => {
      discard = true;
    };
    // Pool listeners cover idle clients only; checked-out sockets can also fail.
    client.on('error', onClientError);
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
      // Destroyed sockets may emit a late error; retain their listener until GC.
      if (!discard) client.removeListener('error', onClientError);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.pool.ended) await this.pool.end();
  }
}
