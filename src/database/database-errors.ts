const transientCodes = new Set([
  '53300', // too many connections
  '57P01',
  '57P02',
  '57P03', // shutdown, crash, starting up
  '57014',
  '55P03', // statement cancellation/timeout, lock timeout
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

// pg/pg-pool emit these connection failures without a code. Match only known
// driver messages; SQL/programming errors must still reach the 500 handler.
const connectionMessages = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'timeout expired',
]);

export function isTransientDatabaseError(error: unknown): boolean {
  // Native driver errors can originate outside the application's JS realm.
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? error.code : undefined;
  if (typeof code === 'string') {
    return /^08[A-Z0-9]{3}$/.test(code) || transientCodes.has(code);
  }
  return (
    'message' in error &&
    typeof error.message === 'string' &&
    connectionMessages.has(error.message)
  );
}
