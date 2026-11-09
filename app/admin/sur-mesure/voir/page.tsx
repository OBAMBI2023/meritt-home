import { Suspense } from 'react';
import { CustomRequestView } from '@/components/admin/custom-request-view';

export default function AdminCustomRequestPage() {
  return (
    <Suspense fallback={null}>
      <CustomRequestView />
    </Suspense>
  );
}
