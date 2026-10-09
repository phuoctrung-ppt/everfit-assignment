import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { requestIdMiddleware } from './common/request-id.middleware';
import { jsonBodyMiddleware } from './common/json-body.middleware';
import { validateEnvironment } from './config/configuration';
import { configureSwagger } from './config/swagger';

export async function createApplication(): Promise<NestExpressApplication> {
  // Validate before importing the dynamic ConfigModule or opening a listener.
  validateEnvironment(process.env);
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
    abortOnError: false,
  });
  try {
    configureApplication(app);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export function configureApplication(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(jsonBodyMiddleware);
  app.useGlobalPipes(new ZodValidationPipe());
  configureSwagger(app);
  app.enableShutdownHooks();
}
