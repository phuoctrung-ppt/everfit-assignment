import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { configureApplication } from '../src/bootstrap';

class ProbeDto extends createZodDto(
  z.strictObject({ value: z.number().positive() }),
) {}

@Controller('probe')
class ProbeController {
  @Post()
  echo(@Body() body: ProbeDto) {
    return body;
  }

  @Get()
  failure(): never {
    throw new Error(
      'postgresql://secret:password@private/database SELECT internal',
    );
  }
}

describe('HTTP boundary', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unreachable';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('validates strict DTOs globally without numeric coercion', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .send({ value: 1 })
      .expect(201, { value: 1 });
    for (const body of [
      { value: '1' },
      { value: 1, extra: true },
      { value: null },
      {},
    ]) {
      const result = await request(app.getHttpServer())
        .post('/probe')
        .send(body)
        .expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.error.details.length).toBeGreaterThan(0);
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
    }
  });

  it('never exposes internal error messages', async () => {
    const result = await request(app.getHttpServer()).get('/probe').expect(500);
    expect(result.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: [],
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /password|postgres|SELECT|stack/,
    );
  });

  it('classifies unsupported encodings and malformed compression as client errors', async () => {
    for (const [header, value, status, code] of [
      [
        'Content-Type',
        'application/json; charset=unsupported',
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      ],
      ['Content-Encoding', 'unsupported', 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['Content-Encoding', 'gzip', 400, 'VALIDATION_ERROR'],
    ] as const) {
      const result = await request(app.getHttpServer())
        .post('/probe')
        .set('Content-Type', 'application/json')
        .set(header, value)
        .send('{"value":1}')
        .expect(status);
      expect(result.body.error.code).toBe(code);
      expect(result.body.requestId).toBe(result.headers['x-request-id']);
    }
  });

  it('reports an unreachable database as 503', async () => {
    await request(app.getHttpServer()).get('/health').expect(503);
  });

  it('invalid configuration exits before listening without exposing credentials', async () => {
    const execute = promisify(execFile);
    const result = await execute(
      process.execPath,
      ['-r', 'ts-node/register', 'src/main.ts'],
      {
        env: {
          ...process.env,
          DATABASE_URL: 'https://user:startup-secret@host/db',
        },
        timeout: 15000,
      },
    ).then(
      () => {
        throw new Error('Invalid configuration unexpectedly started');
      },
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Invalid configuration: DATABASE_URL');
    expect(result.stdout + result.stderr).not.toContain('startup-secret');
  });
});
