import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isTransientDatabaseError } from '../../database/database-errors';
import { DatabaseService } from '../../database/database.service';
import {
  WorkoutImportSchema,
  type WorkoutImport,
} from '../../schemas/workout-import.schema';

function translateDatabaseError(error: unknown): never {
  if (isTransientDatabaseError(error)) throw new ServiceUnavailableException();
  throw error;
}

const projection = `id,user_id AS "userId",status,total_entries AS "totalEntries",
  total_sets AS "totalSets",total_batches AS "totalBatches",completed_batches AS "completedBatches",
  processed_entries AS "processedEntries",processed_sets AS "processedSets",
  attempts,retry_count AS "retryCount",error,created_at AS "createdAt",updated_at AS "updatedAt"`;
type StoredImport = Omit<WorkoutImport, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};
function map(row: StoredImport): WorkoutImport {
  return WorkoutImportSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
@Injectable()
export class WorkoutImportRepository {
  constructor(private readonly database: DatabaseService) {}

  async enqueue(
    userId: string,
    key: string,
    source: Buffer,
  ): Promise<WorkoutImport> {
    const hash = createHash('sha256').update(source).digest('hex');
    return this.database
      .withTransaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        const result = await client.query<StoredImport>(
          `INSERT INTO workout_imports (id,user_id,idempotency_key,source_hash,source)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING ${projection}`,
          [randomUUID(), userId, key, hash, source],
        );
        if (result.rows[0]) return map(result.rows[0]);
        const existing = await client.query<
          StoredImport & { source_hash: string }
        >(
          `SELECT ${projection},source_hash FROM workout_imports WHERE user_id=$1 AND idempotency_key=$2`,
          [userId, key],
        );
        const row = existing.rows[0];
        if (!row || row.source_hash !== hash) throw new ConflictException();
        return map(row);
      })
      .catch(translateDatabaseError);
  }

  async find(userId: string, id: string): Promise<WorkoutImport> {
    const result = await this.database.pool
      .query<StoredImport>(
        `SELECT ${projection} FROM workout_imports WHERE user_id=$1 AND id=$2`,
        [userId, id],
      )
      .catch(translateDatabaseError);
    if (!result.rows[0]) throw new NotFoundException();
    return map(result.rows[0]);
  }
}
