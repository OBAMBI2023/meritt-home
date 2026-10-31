import type { Metadata } from 'next';
import { AdminGate } from '@/components/admin/admin-gate';

export const metadata: Metadata = {
  title: 'Administration — Meritt Home',
  description: 'Espace réservé aux administrateurs de Meritt Home.',
  robots: { index: false, follow: false, nocache: true },
};

/** Toutes les pages /admin passent par AdminGate : rien n'est affiché sans autorisation confirmée par la base. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
