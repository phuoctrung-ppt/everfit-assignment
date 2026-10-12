export type BulkTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  // attempt is the one-based failed attempt, before the next submission.
  onRetry?: (event: {
    attempt: number;
    status: number;
    delayMs: number;
  }) => Promise<void> | void;
  transport?: BulkTransport;
}

function backoff(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Benchmark-only: invalid bounds throw RangeError; unsafe requests reject TypeError. */
export function createRetryTransport(
  options: RetryOptions = {},
): BulkTransport {
  const {
    maxAttempts = 3,
    baseDelayMs = 100,
    onRetry,
    transport = fetch,
  } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new RangeError('maxAttempts must be an integer from 1 to 5');
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 10000) {
    throw new RangeError('baseDelayMs must be finite and from 0 to 10000');
  }

  return async (url, init) => {
    const headers = new Headers(init.headers);
    if (init.method?.toUpperCase() !== 'POST') {
      throw new TypeError('Retry transport requires POST');
    }
    if (!headers.get('Idempotency-Key')?.trim()) {
      throw new TypeError(
        'Retry transport requires a nonempty Idempotency-Key',
      );
    }
    if (typeof init.body !== 'string') {
      throw new TypeError('Retry transport requires a replayable string body');
    }
    const request = { ...init, method: 'POST', body: init.body };
    const signal = request.signal;
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      const response = await transport(url, {
        ...request,
        headers: new Headers(headers),
      });
      if (response.status !== 503 || attempt === maxAttempts) return response;
      await response.body?.cancel();
      signal?.throwIfAborted();
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      await onRetry?.({ attempt, status: response.status, delayMs });
      await backoff(delayMs, signal);
    }
  };
}
