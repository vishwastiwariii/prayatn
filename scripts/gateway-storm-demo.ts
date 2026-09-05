/**
 * Phase 10 demo — the gateway-storm timeline.
 *
 *   pnpm storm            # 20 payments, seed 20260904
 *   pnpm storm 30 42      # 30 payments, seed 42
 *
 * Deterministic from the seed + config. Proves: when the gateway goes down,
 * Recovery Desk does NOT retry harder — it stops, waits, probes once, and
 * resumes only when the gateway is healthy.
 */
// Relative import: dev script, not a workspace package.
import { runGatewayStormScenario } from '../packages/recovery/src/storm-scenario';

const [payments = 20, seed = 20260904] = process.argv.slice(2).map(Number).filter(Number.isFinite);

async function main(): Promise<void> {
  const r = await runGatewayStormScenario({ payments, seed });
  const cfg = r.simulatorConfig;

  console.log('\nGATEWAY STORM DEMO');
  console.log('─'.repeat(60));
  console.log(`Dataset: gateway-storm-v1   Seed: ${cfg.seed}   Payments: ${payments}`);
  if (cfg.gatewayStorm) {
    console.log(
      `Gateway Storm:  start minute ${cfg.gatewayStorm.startMinute}, ` +
        `duration ${cfg.gatewayStorm.durationMinutes} min, ` +
        `failure rate ${cfg.gatewayStorm.failureRate * 100}%`,
    );
  }
  console.log(
    'Circuit:  threshold 5   window 60s   cooldown 30s   half-open probes 1   drain batch 5',
  );
  console.log('─'.repeat(60));

  console.table(
    r.trace.map((t) => ({
      '#': t.seq,
      minute: t.minute,
      payment: t.paymentId,
      circuit: t.circuitBefore,
      'gateway call': t.gatewayCall,
      result: t.result,
      'next action': t.nextAction,
    })),
  );

  console.log('─'.repeat(60));
  console.log(`Total gateway charges       : ${r.gatewayCharges}   (20 payments — no retry storm)`);
  console.log(`Circuit opened              : ${r.metrics.circuitOpenCount}`);
  console.log(`Blocked recovery attempts   : ${r.metrics.blockedRecoveryAttempts}`);
  console.log(
    `Probe attempts / successful : ${r.metrics.probeAttempts} / ${r.metrics.successfulProbes}`,
  );
  console.log(`Queued during outage        : ${r.metrics.queuedDuringOutage}`);
  console.log(`Resumed after recovery      : ${r.metrics.resumedAfterRecovery}`);
  console.log(`Final circuit state         : ${r.finalCircuitState}`);
  console.log(`Payments recovered          : ${r.recoveredPayments}/${payments}`);
  console.log('\nAudit trail:');
  for (const a of r.audits) console.log(`  ${a.eventType.padEnd(28)} ${a.whatWeSaw}`);
  console.log();
}

void main();
