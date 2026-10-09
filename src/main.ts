import { ConfigService } from '@nestjs/config';
import pino from 'pino';
import { createApplication } from './bootstrap';
import type { Environment } from './schemas/environment.schema';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  try {
    const config = app.get(ConfigService<Environment, true>);
    await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.startsWith('Invalid configuration:')
      ? error.message
      : 'Application startup failed';
  pino().fatal({ message });
  process.exitCode = 1;
});
