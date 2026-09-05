import { PaymentDetailView } from '@/components/payments/payment-detail-view';

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  return <PaymentDetailView paymentId={paymentId} />;
}
