import pino from 'pino';
import { loggingOptions } from './logging';

describe('security-safe error logging', () => {
  it('serializes failures without throwing or exposing raw errors and request secrets', () => {
    const options = loggingOptions('info').pinoHttp;
    if (!options || Array.isArray(options) || !('serializers' in options))
      throw new Error('Expected logger options');
    const lines: string[] = [];
    const logger = pino(options, {
      write: (line) => {
        lines.push(line);
      },
    });
    expect(() =>
      logger.error(
        {
          err: new Error('private SQL and database credentials'),
          req: {
            id: 'request-id',
            method: 'POST',
            headers: { 'idempotency-key': 'private-key' },
            body: { secret: 'private-body' },
          },
        },
        'Request failed',
      ),
    ).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('private');
    expect(JSON.parse(lines[0]!).err).toEqual({ message: 'Request failed' });
  });
});
