import { Nav } from '@/components/nav';
import { KpiHeader } from '@/components/dashboard/kpi-header';
import { GatewayHealthCard } from '@/components/gateway/gateway-health-card';
import { GatewayIncidentBanner } from '@/components/gateway/gateway-incident-banner';
import { RecoveryActivity } from '@/components/dashboard/recovery-activity';
import { RootCauseChart } from '@/components/dashboard/root-cause-chart';
import { ActionDistributionChart } from '@/components/dashboard/action-distribution-chart';
import { RecoveryFunnel } from '@/components/dashboard/recovery-funnel';
import { NaiveVsRecoveryPanel } from '@/components/evaluation/naive-vs-recovery-panel';
import { WhyWeOutperformed } from '@/components/evaluation/why-we-outperformed';
import { HumanReviewPreview } from '@/components/payments/human-review-preview';
import { PaymentTable } from '@/components/payments/payment-table';

export default function Home() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <GatewayIncidentBanner />

        <KpiHeader />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <GatewayHealthCard />
          <div className="lg:col-span-2">
            <RecoveryActivity />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RootCauseChart />
          <ActionDistributionChart />
        </div>

        <RecoveryFunnel />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <NaiveVsRecoveryPanel compact />
          <WhyWeOutperformed />
        </div>

        <HumanReviewPreview />

        <PaymentTable />
      </main>
    </div>
  );
}
