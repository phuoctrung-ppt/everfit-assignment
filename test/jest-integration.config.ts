import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  clearMocks: true,
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  testTimeout: 30000,
};
export default config;
