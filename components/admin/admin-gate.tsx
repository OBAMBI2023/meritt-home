'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AdminContext } from '@/components/admin/admin-context';
import { AdminLoginForm } from '@/components/admin/admin-login-form';
import { AdminShell } from '@/components/admin/admin-shell';
import { BrandLogo } from '@/components/shop/brand-logo';
import { useAdminSession } from '@/hooks/use-admin-session';

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <BrandLogo className="justify-center" />
        {children}
      </div>
    </main>
  );
}

/**
 * Garde de toutes les pages /admin. Le contenu (children) n'est rendu que pour un utilisateur dont
 * l'autorisation a été confirmée par la base ; dans tous les autres cas, il n'est jamais monté.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { state, signOut, retry } = useAdminSession();

  switch (state.status) {
    case 'loading':
    case 'checking':
      return (
        <FullScreenMessage>
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            {state.status === 'loading' ? 'Chargement…' : 'Vérification de vos autorisations…'}
          </div>
        </FullScreenMessage>
      );

    case 'signed_out':
      return <AdminLoginForm />;

    case 'denied':
      return (
        <FullScreenMessage>
          <ShieldAlert className="mx-auto h-8 w-8 text-destructive" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Accès refusé</h1>
          <p className="text-sm text-muted-foreground">
            {state.email ? `Le compte ${state.email}` : 'Ce compte'} n’est pas autorisé à accéder à l’administration de Meritt Home.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" onClick={() => void signOut()}>
              Se déconnecter
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Retour à la boutique</Link>
            </Button>
          </div>
        </FullScreenMessage>
      );

    case 'error':
      return (
        <FullScreenMessage>
          <ShieldAlert className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">Vérification impossible</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {state.message}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" onClick={() => void retry()}>
              Réessayer
            </Button>
            <Button type="button" variant="outline" onClick={() => void signOut()}>
              Se déconnecter
            </Button>
          </div>
        </FullScreenMessage>
      );

    case 'authorized':
      return (
        <AdminContext.Provider value={{ user: state.user, signOut }}>
          <AdminShell>{children}</AdminShell>
        </AdminContext.Provider>
      );
  }
}
