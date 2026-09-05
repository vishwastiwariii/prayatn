import { type Env, loadEnv } from '../src/env';

/**
 * One env for every route test. Built through the real `loadEnv` so the tests
 * exercise the same validation + defaults production does — if a new required
 * variable is added, these tests fail loudly rather than drifting.
 */
export const testEnv: Env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  API_PORT: '4000',
  API_HOST: '0.0.0.0',
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
});
