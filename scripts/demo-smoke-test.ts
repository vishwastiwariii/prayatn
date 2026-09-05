/**
 * Phase 13 §35 — the demo smoke test.
 *
 * Drives the ENTIRE demo against the running stack (API + Postgres + Redis)
 * exactly the way the presenter will, and asserts the things that must be
 * true on stage:
 *
 *   reset -> start -> failures -> classification -> policy -> queue
 *         -> gateway storm -> circuit OPEN -> retries blocked (0 gateway calls)
 *         -> cooldown -> HALF_OPEN -> probe -> CLOSED -> controlled drain
 *         -> AI message -> AI suggestion + human review -> evaluation
 *
 * Run it before recording or presenting:
 *   pnpm demo:smoke-test
 *
 * Nothing here fakes a result: every assertion reads live API responses.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const EXPECTED_SEED = 20260904;
const EXPECTED_DATASET = 'failures-v1';

type Json = Record<string, unknown>;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  }
}

async function api(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<Json> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Json) : {};
  return { ...json, __status: res.status };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main(): Promise<void> {
  console.log('\n\x1b[1mDEMO SMOKE TEST\x1b[0m');
  console.log(`\x1b[2m${API_URL}\x1b[0m`);

  // --- pre-flight ---------------------------------------------------------
  section('Pre-flight');
  const health = await api('/api/demo/health');
  check('API reachable', health.__status === 200);
  check('Database', health.database === true);
  check('Redis', health.redis === true);
  check('Circuit breaker readable', health.circuitBreaker === true);
  check('Simulator', health.simulator === true);
  check('Seed / dataset contract', health.configError === null, `${EXPECTED_SEED} / ${EXPECTED_DATASET}`);
  if (health.worker !== true) {
    console.log('  \x1b[33m!\x1b[0m Recovery worker is not connected — the demo drives execution directly,');
    console.log('    so this is non-fatal, but start it before presenting.');
  }
  if (health.ai !== true) {
    console.log('  \x1b[33m!\x1b[0m No AI provider configured — deterministic fallbacks will be used.');
  }

  // --- reset + start ------------------------------------------------------
  section('Reset & start');
  const reset = await api('/api/demo/reset', 'POST');
  check('Reset', reset.__status === 200);

  const start = await api('/api/demo/start', 'POST');
  check('Start', start.__status === 201);
  check('Seed verified', start.seed === EXPECTED_SEED, String(start.seed));
  check('Dataset verified', start.datasetVersion === EXPECTED_DATASET, String(start.datasetVersion));

  // --- pipeline -----------------------------------------------------------
  section('Failure pipeline');
  const failuresStage = await api('/api/demo/advance', 'POST');
  const ingested = (failuresStage.detail as Json)?.ingested as number;
  check('Failure ingestion', failuresStage.to === 'FAILURES' && ingested === 12, `${ingested} ingested`);

  const classification = await api('/api/demo/advance', 'POST');
  const causes = ((classification.detail as Json)?.causes ?? {}) as Record<string, number>;
  check('Classification', classification.to === 'CLASSIFICATION' && Object.keys(causes).length >= 6,
    Object.entries(causes).map(([k, v]) => `${k}:${v}`).join(' '));
  check('Unknown failure routed for review', (causes.UNKNOWN ?? 0) === 1);

  const decisions = await api('/api/demo/advance', 'POST');
  const actions = ((decisions.detail as Json)?.actions ?? {}) as Record<string, number>;
  check('Policy decisions', decisions.to === 'RECOVERY_DECISIONS' && Object.keys(actions).length >= 4,
    Object.entries(actions).map(([k, v]) => `${k}:${v}`).join(' '));
  check('Not every failure got a retry', (actions.HARD_STOP ?? 0) >= 2 && (actions.HUMAN_REVIEW ?? 0) >= 1);
  check('Queue accepted the schedulable actions', ((decisions.detail as Json)?.queued as number) > 0,
    `${(decisions.detail as Json)?.queued} queued`);

  // --- gateway storm ------------------------------------------------------
  section('Gateway storm & circuit breaker');
  const storm = await api('/api/demo/advance', 'POST');
  const stormCircuit = ((storm.detail as Json)?.circuit ?? {}) as Json;
  check('Storm triggered', storm.to === 'GATEWAY_STORM');
  check('Circuit OPEN after real gateway failures', stormCircuit.state === 'OPEN',
    `${stormCircuit.failureCount}/${stormCircuit.failureThreshold} failures`);

  const blocked = await api('/api/demo/advance', 'POST');
  const blockedDetail = (blocked.detail as Json) ?? {};
  check('Retries blocked while OPEN', (blockedDetail.blocked as number) > 0,
    `${blockedDetail.blocked} blocked`);
  check('Zero gateway calls while OPEN', (blockedDetail.gatewayCalls as number) === 0);

  // --- recovery -----------------------------------------------------------
  section('Gateway recovery');
  const recovery = await api('/api/demo/advance', 'POST');
  check('Gateway restored', recovery.to === 'GATEWAY_RECOVERY');

  const cooldown = ((recovery.detail as Json)?.circuit as Json)?.cooldownSeconds as number;
  console.log(`  \x1b[2mwaiting out the real ${cooldown}s breaker cooldown…\x1b[0m`);
  let halfOpen = false;
  for (let i = 0; i < cooldown + 15; i += 1) {
    await sleep(1000);
    const circuit = await api('/api/gateway/circuit');
    if (circuit.state === 'HALF_OPEN') {
      halfOpen = true;
      break;
    }
  }
  check('Circuit reaches HALF_OPEN after cooldown', halfOpen);

  section('Controlled drain');
  const resumed = await api('/api/demo/advance', 'POST');
  check('Drain started', resumed.to === 'RECOVERY_RESUMED');

  let circuitState = '';
  let recovered = 0;
  for (let batch = 0; batch < 6; batch += 1) {
    const drain = await api('/api/demo/drain', 'POST');
    const detail = (drain.detail as Json) ?? {};
    recovered += (detail.recovered as number) ?? 0;
    circuitState = ((detail.circuit as Json)?.state as string) ?? circuitState;
    if (((detail.attempted as number) ?? 0) === 0) break;
  }
  check('Probe succeeded and circuit CLOSED', circuitState === 'CLOSED', `circuit ${circuitState}`);
  check('Payments recovered after the outage', recovered > 0, `${recovered} recovered in drain`);

  // --- AI + human review --------------------------------------------------
  section('AI & human review');
  const aiMessage = await api('/api/demo/advance', 'POST');
  const message = ((aiMessage.detail as Json)?.message ?? {}) as Json;
  check('Customer message generated', typeof message.content === 'string' && message.content.length > 0,
    `${message.source} / ${message.language}`);

  const suggestion = await api('/api/demo/advance', 'POST');
  const suggested = ((suggestion.detail as Json)?.suggestion ?? {}) as Json;
  check('AI suggestion generated for the unknown failure',
    typeof suggested.suggestedRootCause === 'string',
    `${suggested.suggestedRootCause} @ ${Math.round(((suggested.confidence as number) ?? 0) * 100)}%`);

  const queue = await api('/api/human-review');
  const items = (queue.items ?? []) as Json[];
  const pending = items.find((i) => String(i.paymentId).startsWith('demo_'));
  check('Unknown failure is waiting for a human, not auto-classified', pending !== undefined);
  if (pending) {
    const resolved = await api(`/api/human-review/${pending.failureId}/resolve`, 'POST', {
      decision: 'ACCEPT',
      rootCause: (pending.aiSuggestion as Json | null)?.cause ?? 'ISSUER_TEMPORARY_FAILURE',
      reason: 'Smoke test: reviewer accepted the AI suggestion.',
    });
    check('Human decision recorded as authoritative', resolved.__status === 201 || resolved.__status === 200);
  }

  // --- evaluation ---------------------------------------------------------
  section('Evaluation');
  const started = await api('/api/evaluations', 'POST', { seed: EXPECTED_SEED, count: 500 });
  const evaluationId = started.evaluationId as string;
  check('Experiment ran', typeof evaluationId === 'string');
  const summary = await api(`/api/evaluations/${evaluationId}`);
  const headline = (summary.headline ?? {}) as Json;
  const naive = (headline.naive ?? {}) as Json;
  const rd = (headline.recoveryDesk ?? {}) as Json;
  check('Recovery Desk recovers more than naive',
    (rd.recoveredCount as number) > (naive.recoveredCount as number),
    `${naive.recoveredCount} -> ${rd.recoveredCount}`);
  check('Recovery Desk uses fewer attempts than naive',
    (rd.attemptsConsumed as number) < (naive.attemptsConsumed as number),
    `${naive.attemptsConsumed} -> ${rd.attemptsConsumed}`);

  const finalStages = ['RESULTS', 'COMPLETE'];
  for (const expected of finalStages) {
    const step = await api('/api/demo/advance', 'POST');
    check(`Stage ${expected}`, step.to === expected);
  }

  // --- summary ------------------------------------------------------------
  console.log('');
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1mDEMO READY\x1b[0m  ${passed} checks passed`);
    process.exit(0);
  }
  console.log(`\x1b[31m\x1b[1mDEMO NOT READY\x1b[0m  ${failed} failed / ${passed + failed} checks`);
  for (const f of failures) console.log(`  \x1b[31m-\x1b[0m ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\n\x1b[31mSmoke test crashed:\x1b[0m', err instanceof Error ? err.message : err);
  console.error('Is the API running?  pnpm --filter @recovery-desk/api dev');
  process.exit(1);
});
