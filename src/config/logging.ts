import type { Params } from 'nestjs-pino';
import type { Environment } from '../schemas/environment.schema';

export function loggingOptions(level: Environment['LOG_LEVEL']): Params {
  return {
    pinoHttp: {
      level,
      genReqId: (req) => req.id,
      serializers: {
        req: (req: { id: string; method: string }) => ({
          id: req.id,
          method: req.method,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        err: () => ({ message: 'Request failed' }),
      },
      redact: ['req.headers', 'req.body', 'req.query', 'res.headers'],
    },
  };
}
