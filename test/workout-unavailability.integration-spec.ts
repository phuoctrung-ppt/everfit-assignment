import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../src/bootstrap';
import { postWorkout } from './support/workout-fixtures';

describe('workout database connection failure', () => {
  let app: INestApplication;
  const previousEnvironment = { ...process.env };
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://127.0.0.1:1/unreachable',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    app = await createApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    process.env = previousEnvironment;
  });

  it('returns sanitized 503 when acquiring a database connection fails', async () => {
    const response = await postWorkout(app, 'unavailable').expect(503);
    expect(response.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
      details: [],
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });
});
