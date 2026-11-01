'use client';

import { createContext, useContext } from 'react';
import type { AdminUser } from '@/hooks/use-admin-session';

interface AdminContextValue {
  user: AdminUser;
  signOut: () => Promise<void>;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin doit être utilisé à l’intérieur de AdminGate.');
  return value;
}
