import { Suspense } from 'react';
import { PaymentReceipt } from '@/components/admin/payment-receipt';

export default function AdminReceiptPage() {
  return (
    <Suspense fallback={null}>
      <PaymentReceipt />
    </Suspense>
  );
}
