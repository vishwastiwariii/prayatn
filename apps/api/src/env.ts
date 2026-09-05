import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load environment from the API package first, then fall back to the repo root.
// dotenv does not override variables that are already set, so this order is safe
// whether the process is started from `apps/api` or from the monorepo root.
loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

/**
 * Phase 14 §7 — strict configuration.
 *
 * Every tunable the system has is declared here with an explicit default, so
 * "what is this deployment actually running with?" has one answer. In
 * production the secrets are mandatory: `loadEnv` throws at startup rather
 * than letting a deployment quietly run on development defaults.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- infrastructure ------------------------------------------------------
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- security ------------------------------------------------------------
  /** When false (dev default) the API is open. Always true in production. */
  AUTH_ENABLED: booleanish.default(false),
  ADMIN_API_KEY: z.string().min(16).optional(),
  OPERATOR_API_KEY: z.string().min(16).optional(),
  DEMO_API_KEY: z.string().min(16).optional(),
  /** Max request body. Failure payloads are small; anything larger is abuse. */
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(256 * 1024),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // --- recovery policy knobs (mirrors @recovery-desk/domain defaults) -------
  MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  MAX_MESSAGES_PER_DAY: z.coerce.number().int().min(0).max(10).default(2),
  QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(22),
  QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(8),

  // --- circuit breaker -----------------------------------------------------
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),
  CIRCUIT_FAILURE_WINDOW: z.coerce.number().int().min(1).default(60),
  CIRCUIT_COOLDOWN: z.coerce.number().int().min(1).default(30),

  // --- worker --------------------------------------------------------------
  RECOVERY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Hard ceiling on one job's execution before it is treated as stalled. */
  JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

  // --- AI ------------------------------------------------------------------
  AI_PROVIDER: z.enum(['openai', 'anthropic']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  /** Per-process ceiling on AI calls; observability + a cheap runaway guard. */
  AI_MAX_CALLS_PER_MINUTE: z.coerce.number().int().min(1).default(60),
});

export type Env = z.infer<typeof envSchema>;

/** Secrets a production deployment must not start without (Phase 14 §7). */
const PRODUCTION_REQUIRED: Array<{ key: keyof Env; why: string }> = [
  { key: 'ADMIN_API_KEY', why: 'admin endpoints would be unauthenticated' },
  { key: 'OPERATOR_API_KEY', why: 'operator endpoints would be unauthenticated' },
];

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const missing = PRODUCTION_REQUIRED.filter(({ key }) => !env[key]).map(
      ({ key, why }) => `  - ${key} is required in production (${why})`,
    );
    if (!env.AUTH_ENABLED) {
      missing.push('  - AUTH_ENABLED must be true in production');
    }
    if (env.CORS_ORIGIN.includes('localhost')) {
      missing.push('  - CORS_ORIGIN still points at localhost');
    }
    if (missing.length > 0) {
      // FAIL FAST. Never silently fall back to development defaults.
      throw new Error(`Refusing to start in production:\n${missing.join('\n')}`);
    }
  }

  return env;
}

/** Non-secret configuration, safe to log at startup and to expose on /health. */
export function describeEnv(env: Env): Record<string, unknown> {
  return {
    nodeEnv: env.NODE_ENV,
    authEnabled: env.AUTH_ENABLED,
    corsOrigin: env.CORS_ORIGIN,
    maxAttempts: env.MAX_ATTEMPTS,
    maxMessagesPerDay: env.MAX_MESSAGES_PER_DAY,
    quietHours: `${env.QUIET_HOURS_START}:00-${env.QUIET_HOURS_END}:00`,
    circuit: {
      failureThreshold: env.CIRCUIT_FAILURE_THRESHOLD,
      failureWindowSeconds: env.CIRCUIT_FAILURE_WINDOW,
      cooldownSeconds: env.CIRCUIT_COOLDOWN,
    },
    workerConcurrency: env.RECOVERY_WORKER_CONCURRENCY,
    aiProvider: env.AI_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'none'),
  };
}
