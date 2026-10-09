import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/bootstrap';
import { ExercisesRepository } from '../src/modules/exercises/exercises.repository';

describe('catalog response boundary', () => {
  let app: NestExpressApplication;
  const repository = { list: jest.fn() };
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://127.0.0.1:1/unreachable',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ExercisesRepository)
      .useValue(repository)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('serves an empty catalog through the response serializer', async () => {
    repository.list.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/exercises')
      .expect(200, {
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
  });

  it('rejects malformed output with a sanitized 500 instead of sending invalid data', async () => {
    repository.list.mockResolvedValue([
      { id: 'invalid-sensitive-id', name: 'Bench', muscleGroups: [] },
    ]);
    const result = await request(app.getHttpServer())
      .get('/exercises')
      .expect(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('invalid-sensitive-id');
  });

  it('rejects malformed pagination before accessing the repository', async () => {
    repository.list.mockClear();
    await request(app.getHttpServer())
      .get('/exercises?cursor=invalid')
      .expect(400);
    await request(app.getHttpServer()).get('/exercises?limit=101').expect(400);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it.each([
    ['57014', 503, 'SERVICE_UNAVAILABLE'],
    ['42601', 500, 'INTERNAL_ERROR'],
  ] as const)(
    'returns the correct sanitized HTTP error for database code %s',
    async (code, status, expectedCode) => {
      repository.list.mockRejectedValue(
        Object.assign(new Error('password SELECT secret'), { code }),
      );
      const result = await request(app.getHttpServer())
        .get('/exercises')
        .expect(status);
      expect(result.body.error).toEqual({
        code: expectedCode,
        message:
          status === 503 ? 'Service unavailable' : 'Internal server error',
        details: [],
      });
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
      expect(JSON.stringify(result.body)).not.toMatch(/password|SELECT|secret/);
    },
  );
});
