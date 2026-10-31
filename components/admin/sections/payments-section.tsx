'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Plus, Printer, Search } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { PaymentActionDialog, RecordPaymentDialog, type PaymentAction } from '@/components/admin/sections/payment-dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminQuery } from '@/hooks/use-admin-query';
import {
  STATUS_LABELS,
  balanceOf,
  fetchPayableOrders,
  fetchPaymentMethods,
  fetchPayments,
  fetchPaymentsForExport,
  fetchPaymentsSummary,
  isModuleMissing,
  paymentsToCsv,
  periodBounds,
  type PaymentFilters,
  type PaymentRow,
  type PaymentStatus,
  type PeriodKey,
} from '@/lib/admin/payments';
import { formatPrice } from '@/lib/products';

const PAGE_SIZE = 15;
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: 'week', label: '7 derniers jours' },
  { key: 'month', label: 'Mois en cours' },
  { key: 'custom', label: 'Période libre' },
];
const STATUS_VARIANT: Record<PaymentStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending_confirmation: 'outline',
  confirmed: 'default',
  rejected: 'destructive',
  cancelled: 'secondary',
  reversed: 'destructive',
};

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const formatDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });

function MissingModule() {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-dashed bg-card p-8 text-center">
      <h3 className="text-lg font-semibold">Module d’encaissement non installé</h3>
      <p className="mx-auto max-w-lg text-sm text-muted-foreground">
        Les tables d’encaissement n’existent pas encore dans la base. Appliquez d’abord <code>migration-encaissements.sql</code> (parties 0 à 2) dans l’éditeur SQL de Supabase.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function PaymentsSection() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [action, setAction] = useState<{ payment: PaymentRow; kind: PaymentAction } | null>(null);
  const [exporting, setExporting] = useState(false);

  const bounds = useMemo(() => periodBounds(period, customFrom, customTo), [period, customFrom, customTo]);
  const filters: PaymentFilters = useMemo(() => ({ from: bounds?.from ?? null, to: bounds?.to ?? null, method, status, search }), [bounds, method, status, search]);

  const loadSummary = useCallback(() => (bounds ? fetchPaymentsSummary(bounds.from, bounds.to) : Promise.resolve(null)), [bounds]);
  const loadList = useCallback(() => fetchPayments(filters, page, PAGE_SIZE), [filters, page]);
  const summary = useAdminQuery(loadSummary);
  const list = useAdminQuery(loadList);
  const methods = useAdminQuery(fetchPaymentMethods);
  const orders = useAdminQuery(fetchPayableOrders);

  const reloadAll = () => {
    summary.reload();
    list.reload();
    orders.reload();
  };

  const missing = [summary, list, methods].some((query) => query.state.status === 'error' && isModuleMissing(query.state.code));
  const data = summary.state.status === 'ready' ? summary.state.data : null;
  const total = list.state.status === 'ready' ? list.state.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function exportCsv() {
    setExporting(true);
    try {
      const { rows, truncated } = await fetchPaymentsForExport(filters);
      if (rows.length === 0) return void toast.error('Aucun encaissement à exporter pour ces filtres.');
      const blob = new Blob([paymentsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `encaissements-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(truncated ? `Export de ${rows.length} lignes (limite atteinte : affinez la période).` : `${rows.length} ligne(s) exportée(s).`);
    } catch {
      toast.error('L’export a échoué. Réessayez.');
    } finally {
      setExporting(false);
    }
  }

  const rowActions = (payment: PaymentRow) => (
    <div className="flex flex-wrap justify-end gap-2">
      {payment.status === 'pending_confirmation' && (
        <>
          <Button type="button" size="sm" onClick={() => setAction({ payment, kind: 'confirm' })}>
            Confirmer
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAction({ payment, kind: 'rejected' })}>
            Refuser
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAction({ payment, kind: 'cancelled' })}>
            Annuler
          </Button>
        </>
      )}
      {(payment.status === 'confirmed' || payment.status === 'reversed') && (
        <Button asChild type="button" size="sm" variant="outline">
          <Link href={`/admin/encaissements/recu?id=${payment.id}`} target="_blank">
            <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Reçu
          </Link>
        </Button>
      )}
      {payment.status === 'confirmed' && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setAction({ payment, kind: 'reversed' })}>
          Contrepasser
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Encaissements"
        description="Suivi des paiements des commandes. Un paiement ne compte comme encaissé qu’après confirmation explicite ; rien n’est jamais supprimé, les erreurs se corrigent par annulation ou contrepassation tracée."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={exporting || missing} onClick={() => void exportCsv()}>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {exporting ? 'Export…' : 'Exporter en CSV'}
            </Button>
            <Button type="button" disabled={missing || orders.state.status !== 'ready' || methods.state.status !== 'ready'} onClick={() => setRecordOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Nouvel encaissement
            </Button>
          </div>
        }
      />

      {missing ? (
        <MissingModule />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Période">
            {PERIODS.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={period === item.key ? 'default' : 'outline'}
                aria-pressed={period === item.key}
                onClick={() => {
                  setPeriod(item.key);
                  setPage(0);
                }}
              >
                {item.label}
              </Button>
            ))}
            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Du" type="date" className="h-9 w-40" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(0); }} />
                <Input aria-label="Au" type="date" className="h-9 w-40" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(0); }} />
                {!bounds && <span className="text-xs text-muted-foreground">Choisissez deux dates (début ≤ fin).</span>}
              </div>
            )}
          </div>

          {summary.state.status === 'loading' && <LoadingBlock label="Calcul des indicateurs…" />}
          {summary.state.status === 'error' && <ErrorBlock code={summary.state.code} onRetry={summary.reload} />}
          {data && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Total encaissé" value={formatPrice(data.confirmedTotal)} note="Paiements confirmés sur la période (par date de paiement)." />
                <Stat label="Transactions confirmées" value={String(data.confirmedCount)} note="Sur la période." />
                <Stat label="Reste à encaisser" value={formatPrice(data.outstandingTotal)} note="Toutes périodes : commandes non annulées moins paiements confirmés." />
                <Stat label="En attente de confirmation" value={`${data.pendingCount} · ${formatPrice(data.pendingTotal)}`} note="Toutes périodes. Non compté comme encaissé." />
              </div>
              {data.inconsistentOrders > 0 && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  Rapprochement : {data.inconsistentOrders} commande(s) ont un statut de paiement incohérent avec leurs paiements confirmés. À vérifier.
                </p>
              )}
              <div className="grid gap-4 lg:grid-cols-3">
                <section className="space-y-2 rounded-lg border bg-card p-4" aria-labelledby="by-method">
                  <h3 id="by-method" className="font-sans text-sm font-semibold">Par moyen de paiement</h3>
                  {data.byMethod.length === 0 ? <p className="text-sm text-muted-foreground">Aucun encaissement confirmé sur la période.</p> : (
                    <ul className="space-y-1 text-sm">{data.byMethod.map((row) => <li key={row.method} className="flex justify-between gap-2"><span>{row.method} <span className="text-muted-foreground">({row.count})</span></span><span className="font-medium">{formatPrice(row.total)}</span></li>)}</ul>
                  )}
                </section>
                <section className="space-y-2 rounded-lg border bg-card p-4" aria-labelledby="by-agent">
                  <h3 id="by-agent" className="font-sans text-sm font-semibold">Par agent (enregistré par)</h3>
                  {data.byAgent.length === 0 ? <p className="text-sm text-muted-foreground">Aucun encaissement confirmé sur la période.</p> : (
                    <ul className="space-y-1 text-sm">{data.byAgent.map((row) => <li key={row.agent} className="flex justify-between gap-2"><span className="min-w-0 truncate" title={row.agent}>{row.agent} <span className="text-muted-foreground">({row.count})</span></span><span className="font-medium">{formatPrice(row.total)}</span></li>)}</ul>
                  )}
                </section>
                <section className="space-y-2 rounded-lg border bg-card p-4" aria-labelledby="by-day">
                  <h3 id="by-day" className="font-sans text-sm font-semibold">Rapport par jour</h3>
                  {data.byDay.length === 0 ? <p className="text-sm text-muted-foreground">Aucun encaissement confirmé sur la période.</p> : (
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">{data.byDay.map((row) => <li key={row.day} className="flex justify-between gap-2"><span>{formatDay(row.day)} <span className="text-muted-foreground">({row.count})</span></span><span className="font-medium">{formatPrice(row.total)}</span></li>)}</ul>
                  )}
                </section>
              </div>
              <p className="text-xs text-muted-foreground">
                Rapprochement des commandes non annulées : {data.ordersPaid} soldée(s), {data.ordersPartial} partiellement payée(s), {data.ordersUnpaid} sans paiement confirmé.
              </p>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Rechercher un encaissement" placeholder="Commande, client, téléphone, reçu…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <Select value={method} onValueChange={(value) => { setMethod(value); setPage(0); }}>
              <SelectTrigger aria-label="Filtrer par moyen de paiement"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les moyens</SelectItem>
                {(methods.state.status === 'ready' ? methods.state.data : []).map((item) => <SelectItem key={item.code} value={item.code}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => { setStatus(value); setPage(0); }}>
              <SelectTrigger aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {(Object.keys(STATUS_LABELS) as PaymentStatus[]).map((key) => <SelectItem key={key} value={key}>{STATUS_LABELS[key]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {list.state.status === 'loading' && <LoadingBlock label="Chargement des encaissements…" />}
          {list.state.status === 'error' && <ErrorBlock code={list.state.code} onRetry={list.reload} />}
          {list.state.status === 'ready' &&
            (list.state.data.rows.length === 0 ? (
              <EmptyState title="Aucun encaissement" text="Aucun paiement ne correspond à la période et aux filtres choisis. Enregistrez un premier paiement avec « Nouvel encaissement »." />
            ) : (
              <>
                <div className="hidden rounded-lg border bg-card md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Paiement</TableHead>
                        <TableHead>Commande et client</TableHead>
                        <TableHead>Moyen</TableHead>
                        <TableHead className="text-right">Total dû</TableHead>
                        <TableHead className="text-right">Montant versé</TableHead>
                        <TableHead className="text-right">Solde restant</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.state.data.rows.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {payment.receiptNumber ?? `En attente · ${payment.id.slice(0, 8).toUpperCase()}`}
                            <span className="block text-xs font-normal text-muted-foreground">{formatDateTime(payment.paidAt)}</span>
                          </TableCell>
                          <TableCell>
                            {payment.orderReference}
                            <span className="block text-xs text-muted-foreground">{payment.customerName} · {payment.customerPhone}</span>
                          </TableCell>
                          <TableCell>
                            {payment.methodLabel}
                            {payment.externalReference && <span className="block text-xs text-muted-foreground">{payment.externalReference}</span>}
                          </TableCell>
                          <TableCell className="text-right">{formatPrice(payment.orderTotal)}</TableCell>
                          <TableCell className="text-right font-medium">{formatPrice(payment.amount)}</TableCell>
                          <TableCell className="text-right">{formatPrice(balanceOf(payment))}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[payment.status]}>{STATUS_LABELS[payment.status]}</Badge></TableCell>
                          <TableCell className="max-w-[10rem] truncate text-xs text-muted-foreground" title={payment.recordedByEmail ?? undefined}>{payment.recordedByEmail ?? '—'}</TableCell>
                          <TableCell className="text-right">{rowActions(payment)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="space-y-3 md:hidden">
                  {list.state.data.rows.map((payment) => (
                    <li key={payment.id} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{payment.receiptNumber ?? `En attente · ${payment.id.slice(0, 8).toUpperCase()}`}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(payment.paidAt)}</p>
                        </div>
                        <Badge variant={STATUS_VARIANT[payment.status]}>{STATUS_LABELS[payment.status]}</Badge>
                      </div>
                      <p>{payment.orderReference} · {payment.customerName}</p>
                      <p className="text-xs text-muted-foreground">{payment.customerPhone} · {payment.methodLabel}{payment.externalReference ? ` · ${payment.externalReference}` : ''}</p>
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-muted-foreground">Total dû</dt><dd className="font-medium">{formatPrice(payment.orderTotal)}</dd></div>
                        <div><dt className="text-muted-foreground">Versé</dt><dd className="font-medium">{formatPrice(payment.amount)}</dd></div>
                        <div><dt className="text-muted-foreground">Solde</dt><dd className="font-medium">{formatPrice(balanceOf(payment))}</dd></div>
                      </dl>
                      {payment.recordedByEmail && <p className="truncate text-xs text-muted-foreground">Agent : {payment.recordedByEmail}</p>}
                      {rowActions(payment)}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{total} encaissement(s) · page {page + 1} / {pages}</span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Précédent</Button>
                    <Button type="button" size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
                  </div>
                </div>
              </>
            ))}
        </>
      )}

      <RecordPaymentDialog
        open={recordOpen}
        orders={orders.state.status === 'ready' ? orders.state.data : []}
        methods={methods.state.status === 'ready' ? methods.state.data : []}
        onClose={() => setRecordOpen(false)}
        onRecorded={(message) => {
          setRecordOpen(false);
          toast.success(message);
          reloadAll();
        }}
      />
      <PaymentActionDialog
        payment={action?.payment ?? null}
        action={action?.kind ?? null}
        onClose={() => setAction(null)}
        onDone={(message) => {
          setAction(null);
          toast.success(message);
          reloadAll();
        }}
      />
    </div>
  );
}
