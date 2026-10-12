import { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { CsvError, parse } from 'csv-parse';
import {
  CSV_HEADER,
  CSV_MAX_BYTES,
  CSV_MAX_ENTRIES,
  CSV_MAX_SETS,
  CsvWorkoutRowSchema,
} from '../../schemas/csv-import.schema';
import { CreateWorkoutSchema } from '../../schemas/workout.schema';
import type { CreateWorkoutDto } from '../../schemas/workout.schema';

const fields = CSV_HEADER.split(',');
const CHUNK_BYTES = 16 * 1024;
type CsvEntry = { entryRef: string; record: number; entry: CreateWorkoutDto };

export class CsvImportError extends Error {
  constructor(
    readonly code: string,
    readonly record: number | null = null,
    readonly field: string | null = null,
  ) {
    super('Invalid workout CSV');
    this.name = 'CsvImportError';
  }
}

function* chunks(source: Buffer): Generator<Buffer> {
  for (let offset = 0; offset < source.length; offset += CHUNK_BYTES) {
    yield source.subarray(offset, offset + CHUNK_BYTES);
  }
}

function validateEncoding(source: Buffer): void {
  if (source.length > CSV_MAX_BYTES) {
    throw new CsvImportError('CSV_TOO_LARGE');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (const chunk of chunks(source)) decoder.decode(chunk, { stream: true });
    decoder.decode();
  } catch {
    throw new CsvImportError('CSV_INVALID_ENCODING');
  }
}

function validateEntry(group: CsvEntry): CsvEntry {
  const result = CreateWorkoutSchema.safeParse(group.entry);
  if (!result.success) {
    const path = result.error.issues[0]?.path ?? [];
    const setIndex = path[0] === 'sets' && typeof path[1] === 'number';
    throw new CsvImportError(
      'CSV_INVALID_VALUE',
      group.record + (setIndex ? Number(path[1]) : 0),
      String(setIndex ? (path[2] ?? 'setPosition') : (path[0] ?? 'entryRef')),
    );
  }
  return { ...group, entry: result.data };
}

// Consumers must exhaust a validation pass before performing any writes.
export async function* parseWorkoutCsv(
  source: Buffer,
): AsyncGenerator<CsvEntry> {
  validateEncoding(source);
  const input = Readable.from(chunks(source), { objectMode: false });
  let previousRecordEnd = 0;
  const parser = input.pipe(
    parse({
      bom: true,
      record_delimiter: ['\r\n', '\n'],
      max_record_size: 64 * 1024,
      relax_column_count: true, // Check counts ourselves for safe coordinates.
      skip_empty_lines: false,
      on_record(row, context) {
        previousRecordEnd = context.bytes;
        return row;
      },
      cast(value, context) {
        // Bound delimiter-heavy rows before the parser builds a huge array.
        if (context.index >= fields.length) {
          throw new CsvImportError(
            context.records === 0
              ? 'CSV_INVALID_HEADER'
              : 'CSV_INVALID_COLUMNS',
            context.records || null,
          );
        }
        // Include UTF-8 bytes, quotes and delimiters in the record limit.
        if (context.bytes - previousRecordEnd > 64 * 1024) {
          throw new CsvImportError(
            'CSV_RECORD_TOO_LARGE',
            context.records || null,
            fields[context.index],
          );
        }
        return value;
      },
    }),
  );
  const seen = new Set<string>();
  let headerSeen = false;
  let record = 0;
  let group: CsvEntry | undefined;
  try {
    for await (const raw of parser) {
      const row = raw as string[];
      if (!headerSeen) {
        if (
          row.length !== fields.length ||
          row.some((v, i) => v !== fields[i])
        ) {
          throw new CsvImportError('CSV_INVALID_HEADER');
        }
        headerSeen = true;
        continue;
      }
      record++;
      if (record > CSV_MAX_SETS) {
        throw new CsvImportError('CSV_TOO_MANY_SETS', record);
      }
      if (row.length !== fields.length) {
        throw new CsvImportError('CSV_INVALID_COLUMNS', record);
      }
      const nul = row.findIndex((value) => value.includes('\u0000'));
      if (nul !== -1) {
        throw new CsvImportError('CSV_INVALID_VALUE', record, fields[nul]);
      }
      const result = CsvWorkoutRowSchema.safeParse(row);
      if (!result.success) {
        const index = result.error.issues[0]?.path[0];
        throw new CsvImportError(
          'CSV_INVALID_VALUE',
          record,
          typeof index === 'number' ? fields[index] : null,
        );
      }
      const [entryRef, date, exerciseName, position, reps, weight, unit] =
        result.data;
      if (group?.entryRef !== entryRef) {
        if (seen.has(entryRef)) {
          throw new CsvImportError('CSV_REPEATED_ENTRY', record, 'entryRef');
        }
        if (seen.size >= CSV_MAX_ENTRIES) {
          throw new CsvImportError('CSV_TOO_MANY_ENTRIES', record, 'entryRef');
        }
        if (group) yield validateEntry(group);
        seen.add(entryRef);
        group = { entryRef, record, entry: { date, exerciseName, sets: [] } };
      }
      for (const field of ['date', 'exerciseName'] as const) {
        if (group.entry[field] !== (field === 'date' ? date : exerciseName)) {
          throw new CsvImportError('CSV_ENTRY_MISMATCH', record, field);
        }
      }
      if (position !== group.entry.sets.length + 1) {
        throw new CsvImportError('CSV_INVALID_POSITION', record, 'setPosition');
      }
      group.entry.sets.push({ reps, weight, unit });
    }
    if (!group) throw new CsvImportError('CSV_EMPTY');
    yield validateEntry(group);
  } catch (error) {
    if (error instanceof CsvError) {
      // csv-parse counts completed records including the header, even read-ahead.
      throw new CsvImportError(
        error.code === 'CSV_MAX_RECORD_SIZE'
          ? 'CSV_RECORD_TOO_LARGE'
          : 'CSV_SYNTAX',
        typeof error.records === 'number' && error.records > 0
          ? error.records
          : null,
        typeof error.column === 'number'
          ? (fields[error.column] ?? null)
          : null,
      );
    }
    throw error;
  } finally {
    input.destroy();
    parser.destroy();
  }
}
