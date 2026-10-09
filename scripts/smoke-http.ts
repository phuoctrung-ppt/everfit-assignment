import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { ErrorResponseSchema } from '../src/schemas/http-response.schema';

export function smokeOptions() {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string' },
      'timeout-ms': { type: 'string', default: '10000' },
      'state-file': { type: 'string' },
      'verify-state': { type: 'string' },
    },
  });
  const baseUrl = new URL(values['base-url'] ?? 'http://localhost:3000');
  assert(['http:', 'https:'].includes(baseUrl.protocol));
  assert(!baseUrl.username && !baseUrl.password);
  assert(baseUrl.pathname === '/' && !baseUrl.search && !baseUrl.hash);
  assert(/^[1-9]\d*$/.test(values['timeout-ms']));
  const timeout = Number(values['timeout-ms']);
  assert(Number.isSafeInteger(timeout) && timeout <= 120000);
  assert(!(values['state-file'] && values['verify-state']));
  assert(values['state-file'] !== '' && values['verify-state'] !== '');
  return {
    baseUrl: baseUrl.origin,
    timeout,
    stateFile: values['state-file'],
    verifyState: values['verify-state'],
  };
}

export class SmokeHttp {
  stage = 'configuration';
  requests = 0;
  private readonly requestIds = new Set<string>();
  private responseRequestId = '';

  constructor(private readonly options: ReturnType<typeof smokeOptions>) {}

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    status = 200,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key === undefined ? {} : { 'Idempotency-Key': key }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeout),
      redirect: 'error',
    });
    const requestId = z.uuid().parse(response.headers.get('x-request-id'));
    this.responseRequestId = requestId;
    assert(!this.requestIds.has(requestId));
    this.requestIds.add(requestId);
    assert.equal(response.status, status);
    const result = schema.parse(await response.json());
    this.requests++;
    return result;
  }

  async error(path: string, status: number, body?: unknown, key?: string) {
    const result = await this.request(
      path,
      ErrorResponseSchema,
      status,
      body,
      key,
    );
    assert.equal(
      result.error.code,
      status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION_ERROR',
    );
    assert.equal(result.requestId, this.responseRequestId);
    if (status === 409) assert.deepEqual(result.error.details, []);
    else assert(result.error.details.length > 0);
    return result;
  }
}
