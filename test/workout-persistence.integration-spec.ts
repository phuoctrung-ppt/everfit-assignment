import { Client } from 'pg';
import { WorkoutEntrySchema } from '../src/schemas/workout-response.schema';
import {
  expectPersistence,
  readPersistence,
  type PersistedWrite,
} from './support/persistence-assertions';
import { persistenceCases } from './support/persistence-cases';
import {
  createWorkoutFixture,
  postWorkout,
  type WorkoutFixture,
} from './support/workout-fixtures';

describe('independently observed durable workout persistence', () => {
  let fixture: WorkoutFixture;
  let observer: Client;

  beforeAll(async () => {
    fixture = await createWorkoutFixture();
    // The fixture exposes its isolated database through DATABASE_URL. This
    // client never borrows an API pool connection or participates in its writes.
    observer = new Client({ connectionString: process.env.DATABASE_URL });
    await observer.connect();
  });
  beforeEach(async () => fixture.reset());
  afterAll(async () => {
    try {
      await observer?.end();
    } finally {
      await fixture?.close();
    }
  });

  async function databaseTime(): Promise<Date> {
    const result = await observer.query<{ now: Date }>(
      'SELECT clock_timestamp()::timestamptz(3) AS now',
    );
    return result.rows[0]!.now;
  }

  it.each([false, true])(
    'preserves every column and relationship through HTTP writes, restart and replay (bulk=%s)',
    async (bulk) => {
      const writes: PersistedWrite[] = [];
      const batches = bulk
        ? [
            persistenceCases.slice(0, 3),
            [persistenceCases[3]!, persistenceCases[1]!],
          ]
        : [[persistenceCases[0]!], [persistenceCases[3]!]];
      for (const [index, cases] of batches.entries()) {
        const userId = `persistence-user-${index}`;
        const key = 'same-key-different-users';
        const body = bulk
          ? { entries: cases.map(({ input }) => input) }
          : cases[0]!.input;
        const before = await databaseTime();
        const response = await postWorkout(
          fixture.app,
          key,
          body,
          userId,
          bulk,
        ).expect(201);
        const after = await databaseTime();
        const entries = bulk
          ? WorkoutEntrySchema.array().parse(response.body.data)
          : [WorkoutEntrySchema.parse(response.body.data)];
        expect(entries).toHaveLength(cases.length);
        writes.push({
          userId,
          key,
          bulk,
          cases,
          body,
          response: response.body,
          entries,
          before,
          after,
        });
        // Observe the complete tables after each commit, including earlier users.
        expectPersistence(await readPersistence(observer), writes);
      }

      const committed = await readPersistence(observer);
      const previousApp = fixture.app;
      const previousPool = fixture.service.pool;
      await fixture.restart();
      expect(fixture.app).not.toBe(previousApp);
      expect(fixture.service.pool).not.toBe(previousPool);
      expect(await readPersistence(observer)).toEqual(committed);

      // Reverse replay order to expose accidental cross-user key lookup.
      for (const write of [...writes].reverse()) {
        const replay = await postWorkout(
          fixture.app,
          write.key,
          write.body,
          write.userId,
          bulk,
        ).expect(201);
        expect(replay.body).toEqual(write.response);
        // Detect updates to values/timestamps as well as duplicate inserts.
        expect(await readPersistence(observer)).toEqual(committed);
      }
    },
  );
});
