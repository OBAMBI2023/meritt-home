'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/admin/admin-ui';
import { BrandLogo } from '@/components/shop/brand-logo';
import { Button } from '@/components/ui/button';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { STATUS_LABELS, balanceOf, fetchOrderPayments, fetchPaymentById, type PaymentRow } from '@/lib/admin/payments';
import { formatPrice } from '@/lib/products';
import { SITE } from '@/lib/site';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formatDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

function Receipt({ payment, siblings }: { payment: PaymentRow; siblings: PaymentRow[] }) {
  if (payment.receiptNumber === null) {
    return <EmptyState title="Aucun reçu" text="Ce paiement n’est pas confirmé : un reçu n’est émis qu’après confirmation de l’encaissement." />;
  }
  // Paiements confirmés avant celui-ci (ordre de confirmation) : cumul antérieur.
  const confirmedAt = payment.confirmedAt ?? payment.createdAt;
  const earlier = siblings
    .filter((row) => row.status === 'confirmed' && row.id !== payment.id && (row.confirmedAt ?? row.createdAt) < confirmedAt)
    .reduce((total, row) => total + row.amount, 0);
  const reversed = payment.status === 'reversed';

  return (
    <article className="space-y-6 rounded-lg border bg-card p-6 text-sm print:border-0 print:p-0 sm:p-8" aria-label={`Reçu ${payment.receiptNumber}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="space-y-1">
          <BrandLogo />
          <p className="text-xs text-muted-foreground">{SITE.location}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-semibold">Reçu d’encaissement</p>
          <p className="font-medium">{payment.receiptNumber}</p>
          <p className="text-xs text-muted-foreground">Émis le {formatDateTime(confirmedAt)}</p>
        </div>
      </header>

      {reversed && (
        <p className="rounded-md border-2 border-destructive p-3 text-center font-semibold uppercase tracking-wide text-destructive">Paiement contrepassé : ce reçu n’est plus valable</p>
      )}

      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Client</dt>
        <dd className="font-medium">{payment.customerName}</dd>
        <dt className="text-muted-foreground">Téléphone</dt>
        <dd>{payment.customerPhone}</dd>
        <dt className="text-muted-foreground">Commande</dt>
        <dd className="font-medium">{payment.orderReference}</dd>
        <dt className="text-muted-foreground">Moyen de paiement</dt>
        <dd>
          {payment.methodLabel}
          {payment.externalReference ? ` · transaction ${payment.externalReference}` : ''}
        </dd>
        <dt className="text-muted-foreground">Date du paiement</dt>
        <dd>{formatDateTime(payment.paidAt)}</dd>
        <dt className="text-muted-foreground">Statut</dt>
        <dd>{STATUS_LABELS[payment.status]}</dd>
        <dt className="text-muted-foreground">Enregistré par</dt>
        <dd>{payment.recordedByEmail ?? '—'}</dd>
        <dt className="text-muted-foreground">Confirmé par</dt>
        <dd>{payment.confirmedByEmail ?? '—'}</dd>
      </dl>

      <dl className="space-y-2 rounded-md border p-4">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Montant total de la commande</dt>
          <dd>{formatPrice(payment.orderTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Paiements confirmés précédents</dt>
          <dd>{formatPrice(earlier)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>Montant encaissé (ce reçu)</dt>
          <dd>{formatPrice(payment.amount)}</dd>
        </div>
        <div className="flex justify-between border-t pt-2">
          <dt className="text-muted-foreground">Solde restant à ce jour</dt>
          <dd className="font-medium">{formatPrice(balanceOf(payment))}</dd>
        </div>
      </dl>
      {payment.note && <p className="text-xs text-muted-foreground">Note : {payment.note}</p>}
      <footer className="border-t pt-3 text-center text-xs text-muted-foreground">{SITE.name} · Merci de votre confiance.</footer>
    </article>
  );
}

/** Reçu d'encaissement imprimable (impression du navigateur ou « Enregistrer au format PDF »). */
export function PaymentReceipt() {
  const id = useSearchParams().get('id') ?? '';
  const load = useCallback(async () => {
    if (!UUID.test(id)) return null;
    const payment = await fetchPaymentById(id);
    if (!payment) return null;
    return { payment, siblings: await fetchOrderPayments(payment.orderId) };
  }, [id]);
  const { state, reload } = useAdminQuery(load);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/encaissements">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Encaissements
          </Link>
        </Button>
        <Button type="button" size="sm" onClick={() => window.print()} disabled={state.status !== 'ready' || state.data === null || state.data.payment.receiptNumber === null}>
          <Printer className="mr-2 h-4 w-4" aria-hidden />
          Imprimer
        </Button>
      </div>

      {state.status === 'loading' && <LoadingBlock label="Chargement du reçu…" />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' && state.data === null && <EmptyState title="Reçu introuvable" text="Ce paiement n’existe pas ou vous n’avez pas le droit de le consulter." />}
      {state.status === 'ready' && state.data && <Receipt payment={state.data.payment} siblings={state.data.siblings} />}
    </div>
  );
}
