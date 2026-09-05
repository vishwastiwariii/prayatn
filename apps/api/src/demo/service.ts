import {
  DEFAULT_GATEWAY_RELIABILITY_SETTINGS,
  createRedisCircuitStore,
} from '@recovery-desk/circuit-breaker';
import { Prisma, prismaClient } from '@recovery-desk/db';
import {
  DEMO_AI_MESSAGE_PAYMENT_ID,
  DEMO_AMOUNT_AT_RISK_MINOR,
  DEMO_CUSTOMERS,
  DEMO_DATASET_VERSION,
  DEMO_ID_PREFIX,
  DEMO_PAYMENTS,
  DEMO_SEED,
  DEMO_UNKNOWN_PAYMENT_ID,
  type DemoController,
  type DemoStage,
} from '@recovery-desk/demo';
import {
  decideRecovery,
  enqueueRecoveryAction,
  executeRecoveryAction,
  getLiveCircuitBreaker,
  getRecoveryQueue,
  liveDecideDeps,
  liveEnqueueDeps,
  liveExecuteDeps,
  resetLiveGateway,
  setLiveGateway,
} from '@recovery-desk/recovery';
import { createSimulator } from '@recovery-desk/simulator';
import type { AIClient } from '@recovery-desk/ai';
import type { Redis } from 'ioredis';
import { classifyFailure } from '../classification/service';
import { normalizeFailure } from '../ingestion/normalize';
import { parseFailurePayload } from '../ingestion/schema';
import { ingestFailure } from '../ingestion/service';
import { generateFailureSuggestion } from '../services/ai-suggestion-service';
import { generateAndPersistMessage } from '../services/recovery-message-service';

/**
 * Phase 13 — the demo orchestrator.
 *
 * Every stage here drives the REAL pipeline: real ingestion, the real
 * deterministic classifier, the real policy engine, the real BullMQ queue,
 * the real Redis circuit breaker, the real executor and the real AI services.
 * The only thing the demo controls is *when* each step happens, so a
 * presenter can narrate it.
 *
 * Isolation (§28): every row the demo creates is id-prefixed `demo_`.
 * `reset()` deletes exactly that prefix — development data is never touched.
 */

export interface DemoServiceDeps {
  controller: DemoController;
  redis: Redis;
  aiClient: AIClient | null;
}

export interface DemoIdentity {
  demoId: string;
  seed: number;
  datasetVersion: string;
}

export interface DemoCounters {
  failures: number;
  classified: number;
  decisions: number;
  queued: number;
  blockedByCircuit: number;
  recovered: number;
  hardStopped: number;
  humanReview: number;
  messagesGenerated: number;
  amountAtRiskMinor: number;
  amountRecoveredMinor: number;
}

const STORM_DURATION_MINUTES = 20;

/** 38329 -> "27d" — presentable in an activity feed. */
function formatDelay(minutes: number): string {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// reset / start
// ---------------------------------------------------------------------------

/** Phase 13 §3 — wipe only this demo's rows, plus queue + breaker + gateway. */
export async function resetDemo(deps: DemoServiceDeps): Promise<{ deleted: Record<string, number> }> {
  const demoLike = { startsWith: DEMO_ID_PREFIX };

  // audit_events is onDelete: SetNull from Payment, so it must go first and
  // explicitly — otherwise a reset would leave orphaned demo audit rows behind.
  const audits = await prismaClient.auditEvent.deleteMany({ where: { paymentId: demoLike } });
  // Payment cascades to failures -> classifications, actions -> outcomes, and messages.
  const payments = await prismaClient.payment.deleteMany({ where: { id: demoLike } });
  const customers = await prismaClient.customer.deleteMany({ where: { id: demoLike } });

  const removedJobs = await removeDemoJobs();
  await resetCircuitBreaker(deps.redis);
  resetLiveGateway();
  deps.controller.reset();

  return {
    deleted: {
      auditEvents: audits.count,
      payments: payments.count,
      customers: customers.count,
      queuedJobs: removedJobs,
    },
  };
}

async function removeDemoJobs(): Promise<number> {
  try {
    const queue = getRecoveryQueue();
    const jobs = await queue.getJobs(['delayed', 'waiting']);
    let removed = 0;
    for (const job of jobs) {
      const paymentId = (job.data as { paymentId?: string } | undefined)?.paymentId;
      if (paymentId?.startsWith(DEMO_ID_PREFIX)) {
        await job.remove();
        removed += 1;
      }
    }
    return removed;
  } catch {
    // Redis unavailable — reset must still clear the database half.
    return 0;
  }
}

async function resetCircuitBreaker(redis: Redis): Promise<void> {
  const store = createRedisCircuitStore({
    redis,
    failureWindowSeconds: DEFAULT_GATEWAY_RELIABILITY_SETTINGS.circuit.failureWindowSeconds,
  });
  await store.reset();
}

/** Phase 13 §4 — create the curated dataset and hand back the run identity. */
export async function startDemo(deps: DemoServiceDeps): Promise<DemoIdentity> {
  for (const customer of DEMO_CUSTOMERS) {
    await prismaClient.customer.upsert({
      where: { id: customer.id },
      update: {},
      create: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        balanceState: customer.balanceState,
        salaryDay: customer.salaryDay,
        preferredLanguage: customer.preferredLanguage,
      },
    });
  }

  for (const payment of DEMO_PAYMENTS) {
    await prismaClient.payment.upsert({
      where: { id: payment.id },
      update: {},
      create: {
        id: payment.id,
        customerId: payment.customerId,
        amount: payment.amount,
        currency: 'INR',
        method: payment.method,
        status: 'PENDING',
      },
    });
  }

  const demoId = `demo_${Date.now().toString(36)}`;
  deps.controller.start(demoId);
  deps.controller.record(
    'DEMO_DATASET_LOADED',
    `${DEMO_PAYMENTS.length} payments loaded (₹${(DEMO_AMOUNT_AT_RISK_MINOR / 100).toLocaleString('en-IN')} at risk).`,
  );

  return { demoId, seed: DEMO_SEED, datasetVersion: DEMO_DATASET_VERSION };
}

// ---------------------------------------------------------------------------
// stage work
// ---------------------------------------------------------------------------

export interface StageResult {
  stage: DemoStage;
  detail: Record<string, unknown>;
}

/**
 * Runs the REAL work for the stage we just moved into. Anything that throws
 * is reported as a stage note rather than failing the whole demo (§26).
 */
export async function runStageWork(stage: DemoStage, deps: DemoServiceDeps): Promise<StageResult> {
  switch (stage) {
    case 'FAILURES':
      return { stage, detail: await ingestDemoFailures(deps) };
    case 'CLASSIFICATION':
      return { stage, detail: await classifyDemoFailures(deps) };
    case 'RECOVERY_DECISIONS':
      return { stage, detail: await decideAndQueueDemoActions(deps) };
    case 'GATEWAY_STORM':
      return { stage, detail: await startGatewayStorm(deps) };
    case 'CIRCUIT_OPEN':
      return { stage, detail: await observeCircuitProtection(deps) };
    case 'GATEWAY_RECOVERY':
      return { stage, detail: await recoverGateway(deps) };
    case 'RECOVERY_RESUMED':
      return { stage, detail: await drainRecoveryQueue(deps) };
    case 'AI_MESSAGE':
      return { stage, detail: await generateDemoMessage(deps) };
    case 'HUMAN_REVIEW':
      return { stage, detail: await generateDemoSuggestion(deps) };
    default:
      return { stage, detail: {} };
  }
}

async function ingestDemoFailures(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  let ingested = 0;
  for (const payment of DEMO_PAYMENTS) {
    // Exactly the path POST /api/payments/failures takes: parse the same wire
    // payload, normalize it, then hand it to the same ingestion service.
    const body = {
      paymentId: payment.id,
      amount: payment.amountMinor / 100,
      currency: 'INR',
      method: payment.method,
      error: payment.error,
    };
    const parsed = parseFailurePayload(body);
    if (!parsed.ok) continue;
    const normalized = normalizeFailure(parsed.value);
    if (!normalized.ok) continue;

    const result = await ingestFailure({
      normalized: normalized.value,
      idempotencyKey: `${payment.id}:demo-failure`,
      rawPayload: { demo: true, ...body },
      normalizationNotes: normalized.notes,
    });
    if (result.status === 'ACCEPTED') {
      ingested += 1;
      deps.controller.record(
        'FAILURE_INGESTED',
        `${payment.id} · ₹${(payment.amountMinor / 100).toLocaleString('en-IN')} · ${payment.method} · ${payment.error.reason}`,
      );
    }
  }
  return {
    ingested,
    total: DEMO_PAYMENTS.length,
    amountAtRiskMinor: DEMO_AMOUNT_AT_RISK_MINOR,
  };
}

async function classifyDemoFailures(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  const failures = await demoFailures();
  const causes: Record<string, number> = {};

  for (const failure of failures) {
    const result = await classifyFailure(failure.id);
    if (result.status === 'CLASSIFIED' || result.status === 'DUPLICATE') {
      const cause = result.classification.cause;
      causes[cause] = (causes[cause] ?? 0) + 1;
      if (result.status === 'CLASSIFIED') {
        deps.controller.record(
          'CLASSIFICATION_COMPLETED',
          `${failure.paymentId} · ${cause} · ${Math.round(result.classification.confidence * 100)}% (rule ${result.classification.ruleId ?? 'n/a'})`,
        );
      }
    }
  }
  return { classified: failures.length, causes };
}

async function decideAndQueueDemoActions(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  const failures = await demoFailures();
  const actions: Record<string, number> = {};
  let queued = 0;

  for (const failure of failures) {
    const decision = await decideRecovery(failure.id, liveDecideDeps);
    if (decision.status !== 'DECIDED' && decision.status !== 'DUPLICATE') continue;

    const action = decision.action;
    actions[action.action] = (actions[action.action] ?? 0) + 1;

    if (decision.status === 'DECIDED') {
      deps.controller.record(
        'RECOVERY_POLICY_EVALUATED',
        `${action.paymentId} · ${action.cause} → ${action.action}` +
          (action.delayMinutes ? ` (in ${formatDelay(action.delayMinutes)})` : ''),
      );
    }

    // Real enqueue against real BullMQ. The natural `scheduledFor` delay means
    // the background worker will not race the presenter mid-demo.
    if (action.status === 'PENDING') {
      const enqueued = await enqueueRecoveryAction(action.id, liveEnqueueDeps);
      if (enqueued.status === 'ENQUEUED') queued += 1;
    }
  }

  return { decisions: Object.values(actions).reduce((a, b) => a + b, 0), actions, queued };
}

/**
 * Phase 13 §10-11 — put the executor in front of an unhealthy gateway and let
 * the REAL circuit breaker react. Nothing about the breaker, its thresholds
 * or the policy engine changes; only the simulated gateway's health does.
 */
async function startGatewayStorm(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  setLiveGateway(
    createSimulator({
      seed: DEMO_SEED,
      gatewayStorm: {
        enabled: true,
        originMs: Date.now(),
        startMinute: 0,
        durationMinutes: STORM_DURATION_MINUTES,
        failureRate: 1,
        code: '503',
      },
    }),
  );
  deps.controller.record('GATEWAY_STORM_STARTED', 'Simulated gateway now returning HTTP 503.');

  const executed = await executeDemoActions(deps, 8);
  const circuit = await getLiveCircuitBreaker().getSnapshot();

  return { ...executed, circuit };
}

async function observeCircuitProtection(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  // Try again while the breaker is open: these must be blocked and rescheduled,
  // with zero gateway calls — "blocked is not lost" (§12).
  const executed = await executeDemoActions(deps, 5);
  const breaker = getLiveCircuitBreaker();
  const [circuit, metrics] = await Promise.all([breaker.getSnapshot(), breaker.getMetrics()]);

  deps.controller.record(
    'RECOVERY_BLOCKED_BY_CIRCUIT',
    `${executed.blocked} recovery actions blocked · ${executed.gatewayCalls} gateway calls made.`,
  );

  return { ...executed, circuit, metrics };
}

async function recoverGateway(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  resetLiveGateway();
  deps.controller.record('GATEWAY_HEALTHY', 'Simulated gateway is healthy again.');

  const circuit = await getLiveCircuitBreaker().getSnapshot();
  return {
    circuit,
    cooldownRemainingSeconds: circuit.remainingCooldownSeconds,
    note:
      circuit.remainingCooldownSeconds > 0
        ? 'The breaker still holds the cooldown. Recovery Desk waits — it does not trust the gateway just because we say it is healthy.'
        : 'Cooldown elapsed. The next attempt will be the half-open probe.',
  };
}

/**
 * Phase 13 §14 — controlled drain. One batch at a time (the breaker's own
 * configured batch size), never the whole queue at once. Safe to call
 * repeatedly from the demo UI.
 */
export async function drainRecoveryQueue(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  const batchSize = DEFAULT_GATEWAY_RELIABILITY_SETTINGS.drain.batchSize;
  const executed = await executeDemoActions(deps, batchSize);
  const breaker = getLiveCircuitBreaker();
  const [circuit, metrics] = await Promise.all([breaker.getSnapshot(), breaker.getMetrics()]);
  const counters = await demoCounters();

  if (executed.recovered > 0) {
    deps.controller.record(
      'PAYMENT_RECOVERED',
      `${executed.recovered} payment(s) recovered in this batch · circuit ${circuit.state}.`,
    );
  }

  return { ...executed, circuit, metrics, remaining: counters.queued };
}

interface ExecuteSummary extends Record<string, unknown> {
  attempted: number;
  recovered: number;
  failed: number;
  blocked: number;
  gatewayCalls: number;
}

/** Executes up to `limit` pending demo actions through the REAL executor. */
async function executeDemoActions(deps: DemoServiceDeps, limit: number): Promise<ExecuteSummary> {
  const actions = await prismaClient.recoveryAction.findMany({
    where: {
      paymentId: { startsWith: DEMO_ID_PREFIX },
      status: { in: ['PENDING', 'SCHEDULED'] },
      action: { in: ['RETRY', 'WAIT', 'SWITCH_RAIL', 'MESSAGE'] },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, paymentId: true },
  });

  const summary: ExecuteSummary = {
    attempted: 0,
    recovered: 0,
    failed: 0,
    blocked: 0,
    gatewayCalls: 0,
  };

  for (const action of actions) {
    summary.attempted += 1;
    let result;
    try {
      result = await executeRecoveryAction(action.id, liveExecuteDeps);
    } catch {
      // A single failed job never ends the demo (§26).
      summary.failed += 1;
      continue;
    }

    switch (result.status) {
      case 'EXECUTED_SUCCESS':
        summary.recovered += 1;
        summary.gatewayCalls += 1;
        break;
      case 'EXECUTED_FAILURE':
        summary.failed += 1;
        summary.gatewayCalls += 1;
        break;
      case 'CIRCUIT_BLOCKED':
        summary.blocked += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}

async function generateDemoMessage(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  const action = await prismaClient.recoveryAction.findFirst({
    where: { paymentId: DEMO_AI_MESSAGE_PAYMENT_ID, requiresCustomerMessage: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!action) {
    return { note: 'No message-eligible action for the demo payment yet.' };
  }

  const result = await generateAndPersistMessage(action.id, { client: deps.aiClient });
  if (result.status === 'CREATED' || result.status === 'DUPLICATE') {
    deps.controller.record(
      'AI_MESSAGE_GENERATED',
      `${result.message.language} message for ${result.message.paymentId} (source ${result.message.source}).`,
    );
    return { message: result.message, recoveryActionId: action.id };
  }
  return { note: result.status, recoveryActionId: action.id };
}

async function generateDemoSuggestion(deps: DemoServiceDeps): Promise<Record<string, unknown>> {
  const failure = await prismaClient.paymentFailure.findFirst({
    where: { paymentId: DEMO_UNKNOWN_PAYMENT_ID },
    orderBy: { occurredAt: 'desc' },
  });
  if (!failure) return { note: 'The unknown-failure demo payment has not been ingested yet.' };

  const result = await generateFailureSuggestion(failure.id, { client: deps.aiClient });
  if (result.status === 'CREATED' || result.status === 'DUPLICATE') {
    deps.controller.record(
      'AI_SUGGESTION_GENERATED',
      `AI suggests ${result.suggestion.suggestedRootCause} at ${Math.round(result.suggestion.confidence * 100)}% — human approval required.`,
    );
    return { suggestion: result.suggestion, failureId: failure.id };
  }
  return { note: result.status, failureId: failure.id };
}

// ---------------------------------------------------------------------------
// live state
// ---------------------------------------------------------------------------

async function demoFailures() {
  return prismaClient.paymentFailure.findMany({
    where: { paymentId: { startsWith: DEMO_ID_PREFIX } },
    orderBy: { occurredAt: 'asc' },
    select: { id: true, paymentId: true },
  });
}

export async function demoCounters(): Promise<DemoCounters> {
  const demoLike = { startsWith: DEMO_ID_PREFIX };

  const [
    failures,
    classified,
    decisions,
    queued,
    recovered,
    hardStopped,
    humanReview,
    messages,
    amountAgg,
    blockedEvents,
  ] = await Promise.all([
    prismaClient.paymentFailure.count({ where: { paymentId: demoLike } }),
    prismaClient.classification.count({
      where: { source: 'RULE', failure: { paymentId: demoLike } },
    }),
    prismaClient.recoveryAction.count({ where: { paymentId: demoLike } }),
    prismaClient.recoveryAction.count({
      where: { paymentId: demoLike, status: { in: ['PENDING', 'SCHEDULED'] } },
    }),
    prismaClient.payment.count({ where: { id: demoLike, status: 'SUCCEEDED' } }),
    prismaClient.payment.count({ where: { id: demoLike, status: 'HARD_STOPPED' } }),
    prismaClient.payment.count({ where: { id: demoLike, recoveryStatus: 'HUMAN_REVIEW' } }),
    prismaClient.recoveryMessage.count({ where: { paymentId: demoLike } }),
    prismaClient.recoveryOutcome.aggregate({
      where: { status: 'SUCCESS', action: { paymentId: demoLike } },
      _sum: { amountRecovered: true },
    }),
    prismaClient.auditEvent.count({
      where: { paymentId: demoLike, eventType: 'RECOVERY_BLOCKED_BY_CIRCUIT' },
    }),
  ]);

  return {
    failures,
    classified,
    decisions,
    queued,
    blockedByCircuit: blockedEvents,
    recovered,
    hardStopped,
    humanReview,
    messagesGenerated: messages,
    amountAtRiskMinor: DEMO_AMOUNT_AT_RISK_MINOR,
    amountRecoveredMinor: Math.round(Number(amountAgg._sum.amountRecovered ?? 0) * 100),
  };
}

/** The demo payments with just enough per-payment detail for the stage views. */
export async function demoPaymentViews() {
  const rows = await prismaClient.payment.findMany({
    where: { id: { startsWith: DEMO_ID_PREFIX } },
    orderBy: { id: 'asc' },
    include: {
      failures: {
        orderBy: { occurredAt: 'desc' },
        take: 1,
        include: { classifications: { orderBy: { createdAt: 'desc' } } },
      },
      recoveryActions: { orderBy: { createdAt: 'desc' }, take: 1 },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const notes = new Map(DEMO_PAYMENTS.map((p) => [p.id, p.note]));

  return rows.map((p) => {
    const failure = p.failures[0] ?? null;
    const classifications = failure?.classifications ?? [];
    const rule = classifications.find((c) => c.source === 'RULE') ?? null;
    const human = classifications.find((c) => c.source === 'HUMAN') ?? null;
    const suggestion = classifications.find((c) => c.source === 'LLM_SUGGESTION') ?? null;
    const action = p.recoveryActions[0] ?? null;
    const message = p.messages[0] ?? null;

    return {
      paymentId: p.id,
      amountMinor: Math.round(Number(p.amount) * 100),
      method: p.method,
      status: p.status,
      recoveryStatus: p.recoveryStatus,
      note: notes.get(p.id) ?? null,
      failure: failure
        ? { id: failure.id, code: failure.errorCode, reason: failure.errorReason }
        : null,
      classification: human ?? rule
        ? {
            cause: (human ?? rule)?.cause ?? null,
            confidence: (human ?? rule)?.confidence ?? null,
            source: (human ?? rule)?.source ?? null,
            ruleId: (human ?? rule)?.ruleId ?? null,
          }
        : null,
      aiSuggestion: suggestion
        ? {
            cause: suggestion.cause,
            confidence: suggestion.confidence,
            explanation: suggestion.explanation,
          }
        : null,
      action: action
        ? {
            id: action.id,
            action: action.action,
            status: action.status,
            delayMinutes: action.delayMinutes,
            attemptNumber: action.attemptNumber,
            maxAttempts: action.maxAttempts,
            reason: action.reason,
          }
        : null,
      message: message
        ? { content: message.content, language: message.language, source: message.source }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// health (§34)
// ---------------------------------------------------------------------------

export interface DemoHealth {
  database: boolean;
  redis: boolean;
  api: boolean;
  worker: boolean;
  simulator: boolean;
  circuitBreaker: boolean;
  evaluation: boolean;
  ai: boolean;
  details: Record<string, string>;
}

export async function demoHealth(
  deps: DemoServiceDeps,
  evaluationReady: () => boolean,
): Promise<DemoHealth> {
  const details: Record<string, string> = {};

  const database = await check(async () => {
    await prismaClient.$queryRaw`SELECT 1`;
    return true;
  }, details, 'database');

  const redis = await check(async () => (await deps.redis.ping()) === 'PONG', details, 'redis');

  const worker = await check(
    async () => {
      const workers = await getRecoveryQueue().getWorkers();
      details.worker = `${workers.length} worker(s) connected`;
      return workers.length > 0;
    },
    details,
    'worker',
  );

  const circuitBreaker = await check(
    async () => {
      const snapshot = await getLiveCircuitBreaker().getSnapshot();
      details.circuitBreaker = `state ${snapshot.state}`;
      return true;
    },
    details,
    'circuitBreaker',
  );

  const simulator = await check(
    async () => {
      const config = liveExecuteDeps.gateway.describeConfig();
      details.simulator = config.gatewayStorm?.enabled ? 'storm active' : 'healthy';
      return true;
    },
    details,
    'simulator',
  );

  const evaluation = evaluationReady();
  if (!evaluation) details.evaluation = 'not run yet — POST /api/evaluations';

  const ai = deps.aiClient != null;
  details.ai = ai ? 'provider configured' : 'no provider — deterministic fallbacks will be used';

  return { database, redis, api: true, worker, simulator, circuitBreaker, evaluation, ai, details };
}

async function check(
  fn: () => Promise<boolean>,
  details: Record<string, string>,
  key: string,
): Promise<boolean> {
  try {
    return await fn();
  } catch (err) {
    details[key] = err instanceof Error ? err.message : 'check failed';
    return false;
  }
}

export const DEMO_CONSTANTS = {
  seed: DEMO_SEED,
  datasetVersion: DEMO_DATASET_VERSION,
  amountAtRiskMinor: DEMO_AMOUNT_AT_RISK_MINOR,
  paymentCount: DEMO_PAYMENTS.length,
  stormDurationMinutes: STORM_DURATION_MINUTES,
  circuit: DEFAULT_GATEWAY_RELIABILITY_SETTINGS.circuit,
  drain: DEFAULT_GATEWAY_RELIABILITY_SETTINGS.drain,
} satisfies Record<string, unknown> & { seed: number };

export type { Prisma };
