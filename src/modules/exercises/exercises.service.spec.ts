import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { runInNewContext } from 'node:vm';
import { ExercisesRepository } from './exercises.repository';
import { ExercisesService } from './exercises.service';

describe('ExercisesService', () => {
  const repository = { list: jest.fn(), findByNormalizedNames: jest.fn() };
  const exercise = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Bench Press',
    normalizedName: 'bench press',
    muscleGroups: ['chest'],
  };
  let service: ExercisesService;
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ExercisesService,
        { provide: ExercisesRepository, useValue: repository },
      ],
    }).compile();
    service = module.get(ExercisesService);
  });

  it('maps catalog records to public fields and supports an empty catalog', async () => {
    repository.list.mockResolvedValueOnce([exercise]).mockResolvedValueOnce([]);
    expect(await service.list()).toEqual({
      data: [
        {
          id: exercise.id,
          name: exercise.name,
          muscleGroups: ['chest'],
        },
      ],
    });
    expect(await service.list()).toEqual({
      data: [],
    });
  });

  it('normalizes and deduplicates lookup names while retaining the supplied transaction client', async () => {
    const client = {} as PoolClient;
    repository.findByNormalizedNames.mockResolvedValue([exercise]);
    const found = await service.resolveNames(client, [
      ' bench PRESS ',
      'Bench Press',
      'missing',
    ]);
    expect(repository.findByNormalizedNames).toHaveBeenCalledWith(client, [
      'bench press',
      'missing',
    ]);
    expect([...found]).toEqual([['bench press', exercise]]);
    repository.findByNormalizedNames.mockClear();
    expect(await service.resolveNames(client, [])).toEqual(new Map());
    expect(repository.findByNormalizedNames).not.toHaveBeenCalled();
  });

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    '08006',
    '53300',
    '57P01',
    '57P02',
    '57P03',
    '57014',
    '55P03',
  ])('translates transient database failure %s into 503', async (code) => {
    repository.list.mockRejectedValue(
      Object.assign(new Error('internal'), { code }),
    );
    await expect(service.list()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each([
    'Connection terminated unexpectedly',
    'Connection terminated due to connection timeout',
    'timeout exceeded when trying to connect',
    'timeout expired',
  ])('translates known uncoded driver failure: %s', async (message) => {
    repository.list.mockRejectedValue(new Error(message));
    await expect(service.list()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each(['42601', '23505', '28P01', undefined])(
    'preserves unexpected error %s for the 500 handler',
    async (code) => {
      const error = Object.assign(new Error('unexpected'), { code });
      repository.list.mockRejectedValue(error);
      await expect(service.list()).rejects.toBe(error);
    },
  );

  it('also translates transient lookup failures inside caller-owned transactions', async () => {
    repository.findByNormalizedNames.mockRejectedValue(
      Object.assign(new Error('timeout'), { code: '55P03' }),
    );
    await expect(
      service.resolveNames({} as PoolClient, ['bench press']),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('recognizes native connection errors from a separate JavaScript realm', async () => {
    const error: unknown = runInNewContext(
      "Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })",
    );
    repository.list.mockRejectedValue(error);
    await expect(service.list()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
