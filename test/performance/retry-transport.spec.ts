import { createRetryTransport } from './retry-transport';
import type { BulkTransport } from './retry-transport';
const url = 'http://benchmark.test/bulk';
const body = '{ "entries": [], "label": "é" }\n';
const request = (): RequestInit => ({
  method: 'POST',
  headers: {
    'Idempotency-Key': 'same-key',
    'Content-Type': 'application/json',
  },
  body,
});
const mockTransport = () =>
  jest.fn<Promise<Response>, Parameters<BulkTransport>>();
const response = (status: number) => new Response('result', { status });
describe('benchmark retry transport', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('awaits cleanup and rollback hook before backoff, preserving bytes and key', async () => {
    const rejected = response(503);
    const cancel = jest.spyOn(rejected.body!, 'cancel');
    const success = response(201);
    const transport = mockTransport()
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(success);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const init = request();
    const onRetry = jest.fn(async () => {
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(rejected.bodyUsed).toBe(true);
      init.body = 'changed';
      (init.headers as Record<string, string>)['Idempotency-Key'] = 'changed';
      await gate;
    });
    const pending = createRetryTransport({ transport, onRetry })(url, init);
    await jest.advanceTimersByTimeAsync(1000);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      status: 503,
      delayMs: 100,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(99);
    expect(transport).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(success);
    for (const [target, sent] of transport.mock.calls) {
      expect(target).toBe(url);
      expect(sent.method).toBe('POST');
      expect(Buffer.from(sent.body as string)).toEqual(Buffer.from(body));
      expect(new Headers(sent.headers).get('Idempotency-Key')).toBe('same-key');
    }
  });
  it.each([201, 400, 409, 500])(
    'returns HTTP %i immediately',
    async (status) => {
      const final = response(status);
      const transport = mockTransport().mockResolvedValue(final);
      const onRetry = jest.fn();
      await expect(
        createRetryTransport({ transport, onRetry })(url, request()),
      ).resolves.toBe(final);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
      expect(await final.text()).toBe('result');
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  it.each([1, 3, 5])(
    'returns readable final 503 after %i attempts with exponential delays',
    async (maxAttempts) => {
      const responses = Array.from({ length: maxAttempts }, () =>
        response(503),
      );
      const transport = mockTransport();
      responses.forEach((item) => transport.mockResolvedValueOnce(item));
      const onRetry = jest.fn();
      const options =
        maxAttempts === 3
          ? { transport, onRetry }
          : { transport, onRetry, maxAttempts };
      const pending = createRetryTransport(options)(url, request());
      await jest.runAllTimersAsync();
      const final = await pending;
      expect(transport).toHaveBeenCalledTimes(maxAttempts);
      expect(onRetry.mock.calls).toEqual(
        Array.from({ length: maxAttempts - 1 }, (_, i) => [
          { attempt: i + 1, status: 503, delayMs: 100 * 2 ** i },
        ]),
      );
      expect(responses.slice(0, -1).every((item) => item.bodyUsed)).toBe(true);
      expect(final).toBe(responses.at(-1));
      expect(await final.text()).toBe('result');
    },
  );
  it.each(['before', 'hook', 'backoff'])(
    'aborts %s without extra submissions',
    async (when) => {
      const controller = new AbortController();
      const reason = new Error('stopped');
      const transport = mockTransport().mockImplementation(
        async (_url, init) => {
          expect(init.signal).toBe(controller.signal);
          return response(503);
        },
      );
      const onRetry = jest.fn(() => {
        if (when === 'hook') controller.abort(reason);
      });
      if (when === 'before') controller.abort(reason);
      const pending = createRetryTransport({ transport, onRetry })(url, {
        ...request(),
        signal: controller.signal,
      });
      const assertion = expect(pending).rejects.toBe(reason);
      if (when === 'backoff') {
        await jest.advanceTimersByTimeAsync(50);
        expect(jest.getTimerCount()).toBe(1);
        controller.abort(reason);
      }
      await assertion;
      await jest.runAllTimersAsync();
      expect(transport).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  it.each([
    [{ method: 'GET' }, 'requires POST'],
    [{ method: undefined }, 'requires POST'],
    [{ headers: {} }, 'nonempty Idempotency-Key'],
    [{ headers: { 'Idempotency-Key': '   ' } }, 'nonempty Idempotency-Key'],
    [{ body: undefined }, 'replayable string body'],
    [{ body: new URLSearchParams('a=b') }, 'replayable string body'],
  ] satisfies [RequestInit, string][])(
    'refuses unsafe request %j',
    async (override, message) => {
      const transport = mockTransport();
      const pending = createRetryTransport({ transport })(url, {
        ...request(),
        ...override,
      });
      await expect(pending).rejects.toThrow(TypeError);
      await expect(pending).rejects.toThrow(message);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it.each(['hook', 'network', 'cleanup'])(
    'rejects %s failures without retrying',
    async (source) => {
      const failure = new Error(source);
      const rejected = response(503);
      if (source === 'cleanup')
        jest.spyOn(rejected.body!, 'cancel').mockRejectedValue(failure);
      const transport = mockTransport().mockResolvedValue(rejected);
      if (source === 'network') transport.mockRejectedValue(failure);
      const onRetry = jest.fn(() => {
        throw failure;
      });
      await expect(
        createRetryTransport({ transport, onRetry })(url, request()),
      ).rejects.toBe(failure);
      await jest.runAllTimersAsync();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledTimes(source === 'hook' ? 1 : 0);
      if (source === 'hook') expect(rejected.bodyUsed).toBe(true);
    },
  );
  it.each([0, 6, 1.5, NaN, Infinity])(
    'rejects invalid maxAttempts %s',
    (maxAttempts) => {
      expect(() => createRetryTransport({ maxAttempts })).toThrow(RangeError);
    },
  );
  it.each([-1, 10001, NaN, Infinity])(
    'rejects invalid baseDelayMs %s',
    (baseDelayMs) => {
      expect(() => createRetryTransport({ baseDelayMs })).toThrow(RangeError);
    },
  );
  it.each([0, 10000])(
    'supports baseDelayMs boundary %s',
    async (baseDelayMs) => {
      const transport = mockTransport()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(response(201));
      const pending = createRetryTransport({ transport, baseDelayMs })(
        url,
        request(),
      );
      await jest.runAllTimersAsync();
      expect((await pending).status).toBe(201);
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );
});
