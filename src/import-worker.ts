import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { AppModule } from './app.module';
import { ImportWorkerService } from './modules/imports/import-worker.service';

async function bootstrap(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      await app.get(ImportWorkerService).run(controller.signal);
    } finally {
      // run() releases its advisory lock before the pool is closed.
      await app.close();
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

void bootstrap().catch(() => {
  pino().fatal({ message: 'Import worker stopped unexpectedly' });
  process.exitCode = 1;
});
