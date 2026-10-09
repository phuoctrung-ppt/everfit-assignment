import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  clearMocks: true,
};
export default config;
