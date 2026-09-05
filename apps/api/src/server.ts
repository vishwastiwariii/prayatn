import { closeLiveCircuitBreaker, closeRecoveryQueue } from '@recovery-desk/recovery';
import { buildApp } from './app';
import { describeEnv, loadEnv } from './env';

/**
 * Phase 14 §11 — graceful shutdown.
 *
 *   SIGTERM -> stop accepting requests -> finish in-flight ones
 *           -> close the queue + breaker Redis connections -> close Postgres -> exit
 *
 * Two things this guards against: a second signal re-entering shutdown while
 * the first is still draining, and a hung dependency keeping the process alive
 * forever (the orchestrator would SIGKILL it mid-request instead).
 */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  // FAIL FAST: an invalid or production-incomplete config throws here, before
  // the process ever binds a port.
  const env = loadEnv();
  const app = await buildApp(env);

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      app.log.warn({ event: 'shutdown.duplicate_signal', signal }, 'already shutting down');
      return;
    }
    shuttingDown = true;
    app.log.info({ event: 'shutdown.started', signal }, 'graceful shutdown started');

    const forced = setTimeout(() => {
      app.log.error({ event: 'shutdown.timeout' }, 'shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    // `app.close()` stops accepting new connections and waits for in-flight
    // requests; the prisma/redis plugins close their clients via onClose hooks.
    app
      .close()
      .then(() => closeRecoveryQueue())
      .then(() => closeLiveCircuitBreaker())
      .then(() => {
        app.log.info({ event: 'shutdown.complete', signal }, 'shutdown complete');
        clearTimeout(forced);
        process.exit(0);
      })
      .catch((err) => {
        app.log.error({ event: 'shutdown.failed', err }, 'shutdown failed');
        process.exit(1);
      });
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => shutdown(signal));
  }

  // An unhandled rejection leaves the process in an unknown state; log loudly
  // rather than dying silently (or, worse, continuing to serve traffic).
  process.on('unhandledRejection', (reason) => {
    app.log.error({ event: 'process.unhandled_rejection', err: reason }, 'unhandled rejection');
  });

  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info({ event: 'api.listening', config: describeEnv(env) }, 'API listening');
  } catch (err) {
    app.log.error({ event: 'api.listen_failed', err }, 'failed to listen');
    process.exit(1);
  }
}

void main();
