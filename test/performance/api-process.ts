import { fork } from 'node:child_process';
import { resolve } from 'node:path';

export async function startApiProcess(databaseUrl: string) {
  const child = fork(resolve('test/performance/api-worker.cjs'), [], {
    execArgv: ['--expose-gc', '--max-old-space-size=512'],
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      DB_POOL_MAX: '10',
      DB_STATEMENT_TIMEOUT_MS: '5000',
      DB_LOCK_TIMEOUT_MS: '3000',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  let sequence = 0;
  const receive = <T>(id: number): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('API worker timed out'));
      }, 30000);
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
  child.on(
    'message',
    (message: { id: number; data?: unknown; error?: string }) => {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(message.data);
    },
  );
  const rejectPending = () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('API worker exited unexpectedly'));
    }
    pending.clear();
  };
  child.on('error', rejectPending);
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once('exit', (code, signal) => {
      rejectPending();
      resolve({ code, signal });
    }),
  );
  const command = async <T>(command: string): Promise<T> => {
    if (!child.connected) throw new Error('API worker disconnected');
    const id = ++sequence;
    const result = receive<T>(id);
    child.send({ id, command }, (error) => {
      if (error) rejectPending();
    });
    return result;
  };
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (child.exitCode !== 0)
        throw new Error('API worker did not exit cleanly');
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      try {
        await command('close');
      } catch {
        child.kill('SIGKILL');
      }
      const outcome = await exited;
      if (outcome.code !== 0 || outcome.signal)
        throw new Error('API worker required forced cleanup');
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const ready = await receive<{ url: string; pid: number }>(0);
    return { ...ready, command, close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
export type ApiProcess = Awaited<ReturnType<typeof startApiProcess>>;
