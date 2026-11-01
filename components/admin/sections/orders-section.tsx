'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { nextStatuses, setOrderStatus } from '@/lib/admin/orders';
import { STATUS_LABELS as PAYMENT_STATUS_LABELS, fetchOrderPayments, isModuleMissing, type PaymentRow } from '@/lib/admin/payments';
import { DISPLAY_LABELS as INVOICE_LABELS, createInvoiceDraft, fetchInvoicesOfOrder, isInvoiceModuleMissing, type InvoiceRow } from '@/lib/admin/invoices';
import { AdminQueryError, fetchOrders, type AdminOrder } from '@/lib/admin/queries';
import { formatPrice } from '@/lib/products';

export const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  preparing: 'En préparation',
  ready_for_pickup: 'Prête au retrait',
  shipped: 'En livraison',
  delivered: 'Terminée',
  cancelled: 'Annulée',
};

export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Non payé',
  pending: 'En attente',
  paid: 'Payé',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const MODE_LABELS = { delivery: 'Livraison', pickup: 'Retrait sur place' } as const;

const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;
const paymentLabel = (status: string) => PAYMENT_LABELS[status] ?? status;
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Paiements de la commande : lus en base (vue v_order_payments), jamais calculés à partir du statut affiché. */
function OrderPaymentsPanel({ order }: { order: AdminOrder }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; rows: PaymentRow[] }>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchOrderPayments(order.id)
      .then((rows) => !cancelled && setState({ status: 'ready', rows }))
      .catch((error: unknown) => !cancelled && setState(error instanceof AdminQueryError && isModuleMissing(error.code) ? { status: 'missing' } : { status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const confirmed = state.status === 'ready' ? state.rows.filter((row) => row.status === 'confirmed').reduce((total, row) => total + row.amount, 0) : 0;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Paiements</p>
        <Link href="/admin/encaissements" className="text-xs text-primary underline">
          Gérer les encaissements
        </Link>
      </div>
      {state.status === 'loading' && <p className="text-muted-foreground">Lecture des paiements…</p>}
      {state.status === 'missing' && <p className="text-muted-foreground">Le module d’encaissement n’est pas encore installé en base.</p>}
      {state.status === 'error' && <p className="text-destructive">Les paiements n’ont pas pu être lus.</p>}
      {state.status === 'ready' && (
        <>
          <p>
            Encaissé (confirmé) : <span className="font-medium">{formatPrice(confirmed)}</span> sur {formatPrice(order.total)} · solde restant :{' '}
            <span className="font-medium">{formatPrice(order.total - confirmed)}</span>
          </p>
          {state.rows.length === 0 ? (
            <p className="text-muted-foreground">Aucun paiement enregistré pour cette commande.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {state.rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {formatPrice(row.amount)} · {row.methodLabel}
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(row.paidAt)}
                      {row.receiptNumber ? ` · ${row.receiptNumber}` : ''}
                    </span>
                  </span>
                  <Badge variant={row.status === 'confirmed' ? 'default' : 'outline'}>{PAYMENT_STATUS_LABELS[row.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Facture de la commande : lien vers la facture active, ou création d'un brouillon (la base refuse les doublons). */
function OrderInvoicePanel({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; rows: InvoiceRow[] }>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Garde synchrone contre les doubles soumissions (l'état React n'est à jour qu'au rendu suivant).
  const inFlight = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchInvoicesOfOrder(order.id)
      .then((rows) => !cancelled && setState({ status: 'ready', rows }))
      .catch((error: unknown) => !cancelled && setState(error instanceof AdminQueryError && isInvoiceModuleMissing(error.code) ? { status: 'missing' } : { status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [order.id, attempt]);

  /** Ouvre la confirmation : aucune création n'a lieu avant le clic sur « Confirmer la création ». */
  function ask() {
    setCreateError(null);
    setConfirming(true);
  }

  async function create() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setCreateError(null);
    const result = await createInvoiceDraft(order.id);
    inFlight.current = false;
    setBusy(false);
    if (!result.ok) {
      // La confirmation reste ouverte : le message est lisible et « Confirmer la création » permet de réessayer
      // (la base refuse les doublons, un nouvel essai est sans risque).
      setCreateError(result.message);
      setAttempt((n) => n + 1);
      return;
    }
    setConfirming(false);
    router.push(`/admin/factures/voir?id=${result.data.id}`);
  }

  const active = state.status === 'ready' ? state.rows.find((row) => row.status !== 'cancelled') : undefined;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="font-medium">Facture</p>
      {state.status === 'loading' && <p className="text-muted-foreground">Lecture de la facture…</p>}
      {state.status === 'missing' && <p className="text-muted-foreground">Le module de facturation n’est pas encore installé en base.</p>}
      {state.status === 'error' && <p className="text-destructive">La facture n’a pas pu être lue.</p>}
      {state.status === 'ready' &&
        (active ? (
          <p>
            <Link href={`/admin/factures/voir?id=${active.id}`} className="font-medium text-primary underline">
              {active.number ?? 'Brouillon'}
            </Link>{' '}
            · {INVOICE_LABELS[active.displayStatus]}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              {state.rows.length > 0 ? 'Les factures précédentes de cette commande sont annulées.' : 'Aucune facture pour cette commande.'}
            </p>
            {order.status !== 'cancelled' && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={ask}>
                Créer la facture (brouillon)
              </Button>
            )}
          </div>
        ))}

      <Dialog open={confirming} onOpenChange={(next) => !next && !busy && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Créer un brouillon de facture ?</DialogTitle>
            <DialogDescription>
              Commande <strong>{order.reference}</strong> · {order.customerName} · {formatPrice(order.total)}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Un <strong>brouillon</strong> sera créé à partir de cette commande : client, articles, prix et frais sont lus en base. Ce n’est{' '}
            <strong>pas encore une facture émise</strong> : aucun numéro n’est attribué et vous pourrez la modifier ou l’abandonner avant l’émission.
          </p>
          {createError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {createError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Annuler
            </Button>
            <Button type="button" disabled={busy} onClick={() => void create()}>
              {busy ? 'Création…' : createError ? 'Réessayer' : 'Confirmer la création'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function OrdersSection() {
  const { state, reload } = useAdminQuery(fetchOrders);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const statuses = useMemo(
    () => (state.status === 'ready' ? Array.from(new Set(state.data.orders.map((order) => order.status))).sort() : []),
    [state]
  );

  const rows = useMemo(() => {
    if (state.status !== 'ready') return [];
    const needle = search.trim().toLowerCase();
    return state.data.orders.filter(
      (order) =>
        (!needle || order.reference.toLowerCase().includes(needle) || order.customerName.toLowerCase().includes(needle) || order.customerPhone.includes(needle)) &&
        (statusFilter === 'all' || order.status === statusFilter) &&
        (modeFilter === 'all' || order.mode === modeFilter)
    );
  }, [state, search, statusFilter, modeFilter]);

  // La fiche est relue depuis la liste rechargée : elle reflète toujours le statut réel en base.
  const selected: AdminOrder | null = state.status === 'ready' ? (state.data.orders.find((order) => order.id === selectedId) ?? null) : null;

  async function changeStatus(order: AdminOrder, status: string) {
    if (busy) return;
    setBusy(true);
    const result = await setOrderStatus(order.id, status);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      reload();
      return;
    }
    toast.success(status === 'cancelled' ? 'Commande annulée. Le stock suivi a été restitué.' : `Statut : ${statusLabel(status)}.`);
    reload();
  }

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Commandes"
        description="Commandes enregistrées par la boutique, les plus récentes d’abord. Les changements de statut suivent les étapes autorisées pour la livraison ou le retrait. Le statut de paiement reste « en attente » : il n’est jamais modifié ici."
      />

      {state.status === 'loading' && <LoadingBlock label="Chargement des commandes…" />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.orders.length === 0 ? (
          <EmptyState title="Aucune commande" text="Aucune commande n’a encore été enregistrée. Elles apparaîtront ici dès qu’un client aura confirmé sa commande." />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Rechercher une commande" placeholder="Référence, nom ou téléphone" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filtrer par statut">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={modeFilter} onValueChange={setModeFilter}>
                <SelectTrigger aria-label="Filtrer par mode de réception">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Livraison et retrait</SelectItem>
                  <SelectItem value="delivery">Livraison</SelectItem>
                  <SelectItem value="pickup">Retrait sur place</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="Aucun résultat" text="Aucune commande ne correspond à votre recherche ou à vos filtres." />
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Commande</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Paiement</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Détail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          {order.reference}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {order.customerName} · {formatDate(order.createdAt)}
                          </span>
                        </TableCell>
                        <TableCell>{MODE_LABELS[order.mode]}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{statusLabel(order.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'outline'}>{paymentLabel(order.paymentStatus)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatPrice(order.total)}</TableCell>
                        <TableCell className="text-right">
                          <Button type="button" size="sm" variant="outline" onClick={() => setSelectedId(order.id)}>
                            Voir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {state.data.orders.length} commande(s) chargée(s){state.data.total !== null && state.data.total > state.data.orders.length ? ` sur ${state.data.total}` : ''}. La recherche et les filtres portent sur ces commandes.
            </p>
          </div>
        ))}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && !busy && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Commande {selected.reference}</DialogTitle>
                <DialogDescription>
                  {MODE_LABELS[selected.mode]} · passée le {formatDate(selected.createdAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 text-sm">
                <dl className="grid grid-cols-[7rem_1fr] gap-2">
                  <dt className="text-muted-foreground">Statut</dt>
                  <dd className="font-medium">{statusLabel(selected.status)}</dd>
                  <dt className="text-muted-foreground">Paiement</dt>
                  <dd className="font-medium">
                    {paymentLabel(selected.paymentStatus)} <span className="font-normal text-muted-foreground">(à la livraison ou au retrait)</span>
                  </dd>
                  <dt className="text-muted-foreground">Client</dt>
                  <dd>{selected.customerName}</dd>
                  <dt className="text-muted-foreground">Téléphone</dt>
                  <dd>
                    <a href={`tel:${selected.customerPhone}`} className="text-primary underline">
                      {selected.customerPhone}
                    </a>
                  </dd>
                  <dt className="text-muted-foreground">E-mail</dt>
                  <dd className="break-all">{selected.customerEmail}</dd>
                  {selected.mode === 'delivery' ? (
                    <>
                      <dt className="text-muted-foreground">Livraison</dt>
                      <dd>
                        {selected.address}, {selected.commune}
                        {selected.notes && <span className="block text-muted-foreground">{selected.notes}</span>}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-muted-foreground">Retrait</dt>
                      <dd>Retrait sur place par le client.</dd>
                    </>
                  )}
                </dl>

                <ul className="divide-y rounded-md border">
                  {selected.items.length === 0 ? (
                    <li className="px-3 py-2 text-muted-foreground">Aucun article lisible pour cette commande.</li>
                  ) : (
                    selected.items.map((item, index) => (
                      <li key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>
                          {item.name} <span className="text-muted-foreground">× {item.quantity} · {formatPrice(item.unitPrice)}</span>
                        </span>
                        <span className="font-medium">{formatPrice(item.lineTotal)}</span>
                      </li>
                    ))
                  )}
                </ul>
                <dl className="space-y-1">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Sous-total</dt>
                    <dd>{formatPrice(selected.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{selected.mode === 'pickup' ? 'Retrait sur place' : 'Livraison'}</dt>
                    <dd>{formatPrice(selected.deliveryFee)}</dd>
                  </div>
                  <div className="flex justify-between border-t pt-2 text-base font-semibold">
                    <dt>Total</dt>
                    <dd>{formatPrice(selected.total)}</dd>
                  </div>
                </dl>

                <OrderPaymentsPanel order={selected} />

                <OrderInvoicePanel order={selected} />

                <div className="space-y-2">
                  <p className="font-medium">Faire avancer la commande</p>
                  {nextStatuses(selected.mode, selected.status).length === 0 ? (
                    <p className="text-muted-foreground">Aucun changement de statut possible : la commande est dans un état final.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {nextStatuses(selected.mode, selected.status).map((status) => (
                        <Button
                          key={status}
                          type="button"
                          size="sm"
                          variant={status === 'cancelled' ? 'outline' : 'default'}
                          disabled={busy}
                          onClick={() => void changeStatus(selected, status)}
                        >
                          {status === 'cancelled' ? 'Annuler la commande' : `Passer à « ${statusLabel(status)} »`}
                        </Button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Une annulation restitue le stock suivi, une seule fois.</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
