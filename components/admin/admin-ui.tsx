'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Metric } from '@/lib/admin/queries';

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card px-6 py-12 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function LoadingBlock({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    </div>
  );
}

/** Erreur de lecture : le code aide à diagnostiquer un droit manquant (par exemple 42501 = permission refusée). */
export function ErrorBlock({ code, onRetry }: { code: string | null; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-12 text-center">
      <AlertTriangle className="h-7 w-7 text-warning" aria-hidden />
      <h3 className="text-lg font-semibold">Lecture impossible</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        {code === '42501'
          ? 'Votre compte n’a pas le droit de lire ces données (permission refusée par la base).'
          : 'Les données n’ont pas pu être chargées. Vérifiez votre connexion puis réessayez.'}
        {code && <span className="mt-1 block text-xs">Code d’erreur : {code}</span>}
      </p>
      <Button type="button" variant="outline" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
        Réessayer
      </Button>
    </div>
  );
}

/** Action volontairement indisponible : désactivée, avec la raison affichée. */
export function UnavailableAction({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button type="button" disabled title={reason}>
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

export function StatCard({
  label,
  metric,
  format = (value) => String(value),
  note,
}: {
  label: string;
  metric: Metric | null;
  format?: (value: number) => string;
  note: string;
}) {
  const display = metric === null ? '…' : metric.ok ? format(metric.value) : '—';
  const detail =
    metric === null
      ? note
      : metric.ok
        ? metric.partial
          ? `${note} Résultat partiel : seules les 1 000 premières lignes sont additionnées.`
          : note
        : `Indisponible${metric.code ? ` (code ${metric.code})` : ''}`;
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold">{display}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
