import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { Environment } from '../schemas/environment.schema';

export function configureSwagger(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  if (config.get('NODE_ENV', { infer: true }) !== 'development') return;

  const metadata = new DocumentBuilder()
    .setTitle('Everfit Workout Logging API')
    .setDescription(
      'Implemented API endpoints. Authentication is outside assignment scope.',
    )
    .setVersion('0.1.0')
    .build();
  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, metadata),
  );
  SwaggerModule.setup('docs', app, document, {
    raw: ['json'],
    jsonDocumentUrl: 'docs-json',
  });
}
