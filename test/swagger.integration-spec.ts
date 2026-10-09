import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('development API documentation', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(mode: string) {
    process.env.NODE_ENV = mode;
    process.env.LOG_LEVEL = 'silent';
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unreachable';
    // ConfigModule validates once at module import, as in each fresh process.
    jest.resetModules();
    const { createApplication } = await import('../src/bootstrap');
    app = await createApplication();
    await app.init();
    return app.getHttpServer();
  }

  it('serves Swagger UI and typed OpenAPI for implemented endpoints in development', async () => {
    const server = await start('development');
    const ui = await request(server).get('/docs/').expect(200);
    expect(ui.text).toContain('Swagger UI');
    await request(server).get('/docs/swagger-ui-bundle.js').expect(200);
    const result = await request(server).get('/docs-json').expect(200);
    expect(Object.keys(result.body.paths).sort()).toEqual([
      '/exercises',
      '/health',
    ]);
    const schemas = result.body.components.schemas;
    expect(schemas.HealthResponseDto.properties.status.enum).toEqual(['ok']);
    expect(schemas.ErrorResponseDto.required).toContain('requestId');
    const catalog = result.body.paths['/exercises'].get.responses['200'];
    const schemaName = catalog.content['application/json'].schema.$ref
      .split('/')
      .at(-1);
    expect(schemas[schemaName].properties.data.type).toBe('array');
    expect(JSON.stringify(catalog)).not.toContain('normalizedName');
  });

  it.each(['test', 'production'])(
    'does not serve documentation in %s',
    async (mode) => {
      const server = await start(mode);
      for (const path of [
        '/docs',
        '/docs/',
        '/docs-json',
        '/docs-yaml',
        '/docs/swagger-ui-bundle.js',
      ]) {
        const result = await request(server).get(path).expect(404);
        expect(result.body.error.code).toBe('NOT_FOUND');
      }
      await request(server).get('/health').expect(503);
    },
  );
});
