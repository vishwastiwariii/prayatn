import { Nav } from '@/components/nav';
import { NaiveVsRecoveryPanel } from '@/components/evaluation/naive-vs-recovery-panel';
import { RootCauseBreakdownTable } from '@/components/evaluation/root-cause-breakdown-table';
import { WhyWeOutperformed } from '@/components/evaluation/why-we-outperformed';

export default function EvaluationsPage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Baseline vs Recovery Desk</h1>
          <p className="text-sm text-text-secondary">
            Both strategies process the same seeded dataset, the same hidden issuer/gateway state, and the same
            clock. Only the recovery strategy changes.
          </p>
        </div>
        <NaiveVsRecoveryPanel />
        <RootCauseBreakdownTable />
        <WhyWeOutperformed />
      </main>
    </div>
  );
}
