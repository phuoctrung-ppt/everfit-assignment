import { bulkBody, type Workload } from './workload';

export async function createScenarios(load: Workload) {
  const body = bulkBody();
  const replay = (await load.post('replay-source', body, 201, true)).json;
  const invalid = structuredClone(body);
  invalid.entries[99]!.exerciseName = 'Unknown final exercise';
  const conflict = bulkBody(3);
  return [
    {
      name: 'fresh-c1',
      concurrency: 1,
      work: (key: string) => load.post(key, body, 201, true),
    },
    {
      name: 'fresh-c4',
      concurrency: 4,
      work: (key: string) => load.post(key, body, 201, true),
    },
    {
      name: 'replay-c4',
      concurrency: 4,
      work: () =>
        load.post('replay-source', body, 201, false, undefined, replay),
    },
    {
      name: 'conflict-c4',
      concurrency: 4,
      work: () => load.post('replay-source', conflict, 409),
    },
    {
      name: 'reservation-rollback-c4',
      concurrency: 4,
      work: (key: string) => load.post(key, invalid, 400),
    },
    {
      name: 'fresh-same-key-c4',
      concurrency: 4,
      work: (key: string) =>
        load.post(
          key.replace(/\d+$/, (index) => String(Math.floor(Number(index) / 4))),
          body,
          201,
          true,
        ),
    },
  ];
}
export type Scenario = Awaited<ReturnType<typeof createScenarios>>[number];
