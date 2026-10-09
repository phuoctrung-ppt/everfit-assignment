import { parseArgs } from 'node:util';
import { assertTestDatabaseUrl } from '../support/migrations';

export function datasetConfig(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'database-url': { type: 'string' },
      'create-isolated': { type: 'boolean', default: false },
      entries: { type: 'string', default: '50000' },
      'sets-per-entry': { type: 'string', default: '3' },
      seed: { type: 'string', default: '42' },
      output: { type: 'string' },
    },
  });
  if (Boolean(values['database-url']) === values['create-isolated'])
    throw new Error('Choose --database-url or --create-isolated explicitly');
  if (values['database-url']) assertTestDatabaseUrl(values['database-url']);
  const integer = (value: string, min: number, max: number) => {
    if (!/^\d+$/.test(value) || +value < min || +value > max)
      throw new Error('Dataset argument outside supported range');
    return +value;
  };
  return {
    databaseUrl: values['database-url'],
    entries: integer(values.entries!, 50000, 200000),
    setsPerEntry: integer(values['sets-per-entry']!, 3, 10),
    seed: integer(values.seed!, 0, 1000000),
    output: values.output ?? `artifacts/performance/reads-${Date.now()}.json`,
  };
}
