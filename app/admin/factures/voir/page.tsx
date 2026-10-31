import { Suspense } from 'react';
import { InvoiceView } from '@/components/admin/invoice-view';

export default function AdminInvoicePage() {
  return (
    <Suspense fallback={null}>
      <InvoiceView />
    </Suspense>
  );
}
