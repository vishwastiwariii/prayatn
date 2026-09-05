import type { DemoStage } from '@/lib/api/demo';

/** Mirrors `@recovery-desk/demo`'s DEMO_STAGES — the demo's narrative order. */
export const STAGE_ORDER: DemoStage[] = [
  'READY',
  'FAILURES',
  'CLASSIFICATION',
  'RECOVERY_DECISIONS',
  'GATEWAY_STORM',
  'CIRCUIT_OPEN',
  'GATEWAY_RECOVERY',
  'RECOVERY_RESUMED',
  'AI_MESSAGE',
  'HUMAN_REVIEW',
  'RESULTS',
  'COMPLETE',
];

export function stageAtLeast(current: DemoStage, target: DemoStage): boolean {
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(target);
}
