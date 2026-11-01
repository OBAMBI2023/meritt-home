'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileDown, Plus, Printer, Search } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminQuery } from '@/hooks/use-admin-query';
import {
  DISPLAY_LABELS,
  createInvoiceDraft,
  fetchInvoiceableOrders,
  fetchInvoices,
  fetchInvoicesSummary,
  isInvoiceModuleMissing,
  type DisplayStatus,
  type InvoiceFilters,
  type InvoiceRow,
} from '@/lib/admin/invoices';
import { periodBounds, type PeriodKey } from '@/lib/admin/payments';
import { downloadInvoicePdf } from '@/lib/pdf/download';
import { formatPrice } from '@/lib/products';

const PAGE_SIZE = 15;
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: 'week', label: '7 derniers jours' },
  { key: 'month', label: 'Mois en cours' },
  { key: 'custom', label: 'Période libre' },
];
const STATUS_VARIANT: Record<DisplayStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  issued: 'outline',
  partially_paid: 'outline',
  paid: 'default',
  overdue: 'destructive',
  cancelled: 'destructive',
};
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function NewInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const orders = useAdminQuery(fetchInvoiceableOrders);
  const [orderId, setOrderId] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setOrderId('');
      setFilter('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  const visible = useMemo(() => {
    const list = orders.state.status === 'ready' ? orders.state.data : [];
    const needle = filter.trim().toLowerCase();
    return list.filter((order) => !needle || `${order.reference} ${order.customerName}`.toLowerCase().includes(needle) || order.id === orderId);
  }, [orders.state, filter, orderId]);

  async function submit() {
    if (pending) return;
    if (!orderId) return void setError('Choisissez une commande.');
    setError(null);
    setPending(true);
    const result = await createInvoiceDraft(orderId);
    setPending(false);
    if (!result.ok) return void setError(result.message);
    toast.success(result.data.alreadyExists ? 'Une facture existe déjà pour cette commande : ouverture.' : 'Brouillon créé à partir de la commande.');
    router.push(`/admin/factures/voir?id=${result.data.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle facture</DialogTitle>
          <DialogDescription>Le brouillon reprend le client, les articles, les prix et les frais de la commande, lus en base. Aucun montant n’est saisi.</DialogDescription>
        </DialogHeader>
        {orders.state.status === 'loading' && <LoadingBlock label="Chargement des commandes…" />}
        {orders.state.status === 'error' && <ErrorBlock code={orders.state.code} onRetry={orders.reload} />}
        {orders.state.status === 'ready' && (
          <form
            noValidate
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="inv-order">Commande</Label>
              <Input aria-label="Filtrer les commandes" placeholder="Filtrer par référence ou client" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <select id="inv-order" value={orderId} onChange={(e) => { setOrderId(e.target.value); setError(null); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Choisir une commande…</option>
                {visible.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.reference} — {order.customerName} — {formatPrice(order.total)}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Création…' : 'Créer le brouillon'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InvoicesSection() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [settlement, setSettlement] = useState('all');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const bounds = useMemo(() => periodBounds(period, customFrom, customTo), [period, customFrom, customTo]);
  const filters: InvoiceFilters = useMemo(() => ({ from: bounds?.from ?? null, to: bounds?.to ?? null, status, settlement, search }), [bounds, status, settlement, search]);
  const loadSummary = useCallback(() => (bounds ? fetchInvoicesSummary(bounds.from, bounds.to) : Promise.resolve(null)), [bounds]);
  const loadList = useCallback(() => fetchInvoices(filters, page, PAGE_SIZE), [filters, page]);
  const summary = useAdminQuery(loadSummary);
  const list = useAdminQuery(loadList);

  const missing = [summary, list].some((query) => query.state.status === 'error' && isInvoiceModuleMissing(query.state.code));
  const data = summary.state.status === 'ready' ? summary.state.data : null;
  const total = list.state.status === 'ready' ? list.state.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function pdf(invoice: InvoiceRow) {
    setBusyId(invoice.id);
    try {
      await downloadInvoicePdf(invoice);
    } catch {
      toast.error('Le PDF n’a pas pu être généré : les lignes de la facture sont illisibles.');
    } finally {
      setBusyId(null);
    }
  }

  const actions = (invoice: InvoiceRow) => (
    <div className="flex flex-wrap justify-end gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/admin/factures/voir?id=${invoice.id}`}>Consulter</Link>
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busyId === invoice.id} onClick={() => void pdf(invoice)} aria-label={`Télécharger le PDF de ${invoice.number ?? 'ce brouillon'}`}>
        <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        PDF
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link href={`/admin/factures/voir?id=${invoice.id}&print=1`} target="_blank" aria-label={`Imprimer ${invoice.number ?? 'ce brouillon'}`}>
          <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Imprimer
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Factures"
        description="Une facture se crée à partir d’une commande : client, articles, prix et frais sont lus en base. Le numéro est attribué à l’émission ; une facture émise ne se modifie plus, elle peut seulement être annulée avec un motif."
        action={
          <Button type="button" disabled={missing} onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Nouvelle facture
          </Button>
        }
      />

      {missing ? (
        <div role="alert" className="space-y-2 rounded-lg border border-dashed bg-card p-8 text-center">
          <h3 className="text-lg font-semibold">Module de facturation non installé</h3>
          <p className="mx-auto max-w-lg text-sm text-muted-foreground">
            Les tables de facturation n’existent pas encore dans la base. Appliquez d’abord <code>migration-encaissements.sql</code>, puis <code>migration-factures.sql</code> (parties 0 à 2) dans l’éditeur SQL de Supabase.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Période">
            {PERIODS.map((item) => (
              <Button key={item.key} type="button" size="sm" variant={period === item.key ? 'default' : 'outline'} aria-pressed={period === item.key} onClick={() => { setPeriod(item.key); setPage(0); }}>
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
                <Stat label="Factures émises" value={String(data.issuedCount)} note={`Sur la période. ${data.draftCount} brouillon(s), ${data.cancelledCount} annulée(s).`} />
                <Stat label="Montant facturé" value={formatPrice(data.invoiced)} note="Total des factures émises sur la période." />
                <Stat label="Montant encaissé" value={formatPrice(data.collected)} note="Paiements confirmés rattachés à ces factures." />
                <Stat label="Solde restant" value={formatPrice(data.balance)} note={`${data.paidCount} payée(s), ${data.partialCount} partielle(s), ${data.unpaidCount} sans paiement.`} />
              </div>
              {data.overdueCount > 0 && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {data.overdueCount} facture(s) en retard, pour un solde de {formatPrice(data.overdue)}.
                </p>
              )}
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Rechercher une facture" placeholder="Numéro, client, téléphone, commande…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <Select value={status} onValueChange={(value) => { setStatus(value); setPage(0); }}>
              <SelectTrigger aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="draft">Brouillons</SelectItem>
                <SelectItem value="issued">Émises</SelectItem>
                <SelectItem value="cancelled">Annulées</SelectItem>
              </SelectContent>
            </Select>
            <Select value={settlement} onValueChange={(value) => { setSettlement(value); setPage(0); }}>
              <SelectTrigger aria-label="Filtrer par état de paiement"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les règlements</SelectItem>
                <SelectItem value="unpaid">Sans paiement</SelectItem>
                <SelectItem value="partial">Partiellement payées</SelectItem>
                <SelectItem value="paid">Payées</SelectItem>
                <SelectItem value="overdue">En retard</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {list.state.status === 'loading' && <LoadingBlock label="Chargement des factures…" />}
          {list.state.status === 'error' && <ErrorBlock code={list.state.code} onRetry={list.reload} />}
          {list.state.status === 'ready' &&
            (list.state.data.rows.length === 0 ? (
              <EmptyState title="Aucune facture" text="Aucune facture ne correspond à la période et aux filtres choisis. Créez-en une avec « Nouvelle facture »." />
            ) : (
              <>
                <div className="hidden rounded-lg border bg-card md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Facture</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Commande</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Encaissé</TableHead>
                        <TableHead className="text-right">Solde</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.state.data.rows.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="whitespace-nowrap font-medium">
                            {invoice.number ?? 'Brouillon'}
                            <span className="block text-xs font-normal text-muted-foreground">
                              {invoice.issuedAt ? `Émise le ${formatDate(invoice.issuedAt)}` : `Créé le ${formatDate(invoice.createdAt)}`}
                              {invoice.dueAt ? ` · échéance ${formatDate(invoice.dueAt)}` : ''}
                            </span>
                          </TableCell>
                          <TableCell>
                            {invoice.customerName}
                            <span className="block text-xs text-muted-foreground">{invoice.customerPhone ?? ''}</span>
                          </TableCell>
                          <TableCell>{invoice.orderReference}</TableCell>
                          <TableCell className="text-right">{formatPrice(invoice.total)}</TableCell>
                          <TableCell className="text-right">{invoice.status === 'issued' ? formatPrice(invoice.paid) : '—'}</TableCell>
                          <TableCell className="text-right">{invoice.status === 'issued' ? formatPrice(Math.max(invoice.balance, 0)) : '—'}</TableCell>
                          <TableCell><Badge variant={STATUS_VARIANT[invoice.displayStatus]}>{DISPLAY_LABELS[invoice.displayStatus]}</Badge></TableCell>
                          <TableCell className="text-right">{actions(invoice)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="space-y-3 md:hidden">
                  {list.state.data.rows.map((invoice) => (
                    <li key={invoice.id} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{invoice.number ?? 'Brouillon'}</p>
                          <p className="text-xs text-muted-foreground">{invoice.issuedAt ? `Émise le ${formatDate(invoice.issuedAt)}` : `Créé le ${formatDate(invoice.createdAt)}`}</p>
                        </div>
                        <Badge variant={STATUS_VARIANT[invoice.displayStatus]}>{DISPLAY_LABELS[invoice.displayStatus]}</Badge>
                      </div>
                      <p>{invoice.customerName} · {invoice.orderReference}</p>
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-muted-foreground">Total</dt><dd className="font-medium">{formatPrice(invoice.total)}</dd></div>
                        <div><dt className="text-muted-foreground">Encaissé</dt><dd className="font-medium">{invoice.status === 'issued' ? formatPrice(invoice.paid) : '—'}</dd></div>
                        <div><dt className="text-muted-foreground">Solde</dt><dd className="font-medium">{invoice.status === 'issued' ? formatPrice(Math.max(invoice.balance, 0)) : '—'}</dd></div>
                      </dl>
                      {actions(invoice)}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{total} facture(s) · page {page + 1} / {pages}</span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Précédent</Button>
                    <Button type="button" size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
                  </div>
                </div>
              </>
            ))}
        </>
      )}
      <NewInvoiceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
