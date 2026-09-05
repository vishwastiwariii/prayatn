import { Card, CardHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import type { PaymentDetail } from '@/lib/api/payments';

export function FailureCard({ failure }: { failure: PaymentDetail['failures'][number] }) {
  return (
    <Card>
      <CardHeader title="Failure" subtitle={formatDateTime(failure.occurredAt)} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
        <Field label="Code" value={failure.errorCode} />
        <Field label="Reason" value={failure.errorReason} />
        <Field label="Source" value={failure.errorSource} />
        <Field label="Step" value={failure.errorStep} />
        <div className="col-span-2">
          <Field label="Description" value={failure.errorDescription} />
        </div>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 font-medium text-text-primary">{value}</p>
    </div>
  );
}
