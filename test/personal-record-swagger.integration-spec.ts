import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('personal record OpenAPI contracts', () => {
  let app: INestApplication;
  const previousEnvironment = { ...process.env };
  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://127.0.0.1:1/unreachable',
    });
    jest.resetModules();
    const { createApplication } = await import('../src/bootstrap');
    app = await createApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    process.env = previousEnvironment;
  });
  it('documents required exercises/ranges, response contracts and errors without pagination', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    for (const suffix of ['', '/compare']) {
      const endpoint =
        response.body.paths[`/users/{userId}/personal-records${suffix}`].get;
      const bounds = suffix
        ? ['baselineFrom', 'baselineTo', 'comparisonFrom', 'comparisonTo']
        : ['from', 'to'];
      expect(endpoint.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'userId',
            in: 'path',
            required: true,
          }),
          expect.objectContaining({
            name: 'exerciseName',
            in: 'query',
            required: true,
          }),
          expect.objectContaining({
            name: 'unit',
            in: 'query',
            required: false,
          }),
          ...bounds.map((name) =>
            expect.objectContaining({
              name,
              in: 'query',
              required: Boolean(suffix),
            }),
          ),
        ]),
      );
      expect(endpoint.parameters).toHaveLength(bounds.length + 3);
      for (const status of ['400', '500', '503']) {
        expect(
          endpoint.responses[status].content['application/json'].schema.$ref,
        ).toContain('ErrorResponseDto');
      }
      const ref = endpoint.responses['200'].content[
        'application/json'
      ].schema.$ref
        .split('/')
        .at(-1);
      const schema = response.body.components.schemas[ref];
      expect(schema.properties.data.type).toBe('object');
      expect(schema.properties).not.toHaveProperty('pagination');
      const records = suffix
        ? schema.properties.data.properties.baseline.properties.records
        : schema.properties.data;
      expect(Object.keys(records.properties).sort()).toEqual([
        'estimatedOneRepMax',
        'heaviestSet',
        'highestVolumeSet',
      ]);
    }
  });
});
