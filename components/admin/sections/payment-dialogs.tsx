'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  confirmPayment,
  fetchOrderPayments,
  paymentFormSchema,
  recordPayment,
  setPaymentStatus,
  type PayableOrder,
  type PaymentFormInput,
  type PaymentMethod,
  type PaymentRow,
} from '@/lib/admin/payments';
import { newIdempotencyKey } from '@/lib/orders';
import { formatPrice } from '@/lib/products';

const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

type Errors = Partial<Record<keyof PaymentFormInput, string>>;

/* ------------------------------------------------------------------ */
/* Nouvel encaissement                                                 */
/* ------------------------------------------------------------------ */

interface RecordDialogProps {
  open: boolean;
  orders: PayableOrder[];
  methods: PaymentMethod[];
  presetOrderId?: string | null;
  onClose: () => void;
  /** Reçoit le résultat de l'enregistrement (déjà confirmé par la base). */
  onRecorded: (message: string) => void;
}

export function RecordPaymentDialog({ open, orders, methods, presetOrderId, onClose, onRecorded }: RecordDialogProps) {
  const activeMethods = methods.filter((method) => method.active);
  const [form, setForm] = useState<PaymentFormInput>({ orderId: '', amount: '', method: '', reference: '', paidAt: '', note: '', confirmNow: false });
  const [orderFilter, setOrderFilter] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  // Situation de la commande choisie, relue en base : jamais calculée à partir de données périmées.
  const [balance, setBalance] = useState<{ status: 'idle' | 'loading' | 'error' | 'ready'; total: number; confirmed: number; pending: number }>({ status: 'idle', total: 0, confirmed: 0, pending: 0 });

  useEffect(() => {
    if (!open) return;
    setForm({ orderId: presetOrderId ?? '', amount: '', method: '', reference: '', paidAt: toLocalInput(new Date()), note: '', confirmNow: false });
    setOrderFilter('');
    setErrors({});
    setFormError(null);
    setPending(false);
    setIdempotencyKey(newIdempotencyKey());
  }, [open, presetOrderId]);

  const order = orders.find((candidate) => candidate.id === form.orderId) ?? null;
  const method = activeMethods.find((candidate) => candidate.code === form.method) ?? null;

  useEffect(() => {
    if (!open || !order) {
      setBalance({ status: 'idle', total: 0, confirmed: 0, pending: 0 });
      return;
    }
    let cancelled = false;
    setBalance({ status: 'loading', total: order.total, confirmed: 0, pending: 0 });
    fetchOrderPayments(order.id)
      .then((rows) => {
        if (cancelled) return;
        const sum = (status: string) => rows.filter((row) => row.status === status).reduce((total, row) => total + row.amount, 0);
        setBalance({ status: 'ready', total: order.total, confirmed: sum('confirmed'), pending: sum('pending_confirmation') });
      })
      .catch(() => !cancelled && setBalance({ status: 'error', total: order.total, confirmed: 0, pending: 0 }));
    return () => {
      cancelled = true;
    };
  }, [open, order]);

  const available = balance.total - balance.confirmed - balance.pending;
  const visibleOrders = useMemo(() => {
    const needle = orderFilter.trim().toLowerCase();
    return orders.filter((candidate) => !needle || `${candidate.reference} ${candidate.customerName}`.toLowerCase().includes(needle) || candidate.id === form.orderId);
  }, [orders, orderFilter, form.orderId]);

  const set = (key: keyof PaymentFormInput, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function submit() {
    if (pending) return;
    const parsed = paymentFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof PaymentFormInput] ??= issue.message;
      setErrors(next);
      return;
    }
    if (method?.requiresReference && parsed.data.reference === '') return void setErrors({ reference: 'La référence de transaction est obligatoire pour ce moyen de paiement.' });
    if (balance.status === 'ready' && parsed.data.amount > available) return void setErrors({ amount: `Le montant dépasse le solde disponible (${formatPrice(Math.max(available, 0))}).` });
    setErrors({});
    setFormError(null);
    setPending(true);
    const result = await recordPayment({ ...parsed.data, confirmNow: parsed.data.confirmNow && method?.requiresVerification === false }, idempotencyKey);
    setPending(false);
    if (!result.ok) return void setFormError(result.message);
    onRecorded(
      result.data.status === 'confirmed'
        ? `Paiement confirmé, reçu ${result.data.receiptNumber}. Solde restant : ${formatPrice(result.data.balance)}.`
        : 'Paiement enregistré, en attente de confirmation. Il ne compte pas encore comme encaissé.'
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvel encaissement</DialogTitle>
          <DialogDescription>Un paiement n’est confirmé que par une action explicite. Mobile Money et virement restent « en attente » jusqu’à vérification.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pay-order">Commande *</Label>
            <Input aria-label="Filtrer les commandes" placeholder="Filtrer par référence ou client" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} />
            <select id="pay-order" value={form.orderId} onChange={(e) => set('orderId', e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" aria-invalid={!!errors.orderId}>
              <option value="">Choisir une commande…</option>
              {visibleOrders.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.reference} — {candidate.customerName} — {formatPrice(candidate.total)}
                </option>
              ))}
            </select>
            {errors.orderId && <p className="text-xs text-destructive">{errors.orderId}</p>}
            {order && (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground" role="status">
                {balance.status === 'loading' && 'Lecture du solde…'}
                {balance.status === 'error' && 'Le solde n’a pas pu être lu : la base vérifiera le montant à l’enregistrement.'}
                {balance.status === 'ready' && (
                  <>
                    Total dû {formatPrice(balance.total)} · déjà encaissé {formatPrice(balance.confirmed)} · en attente {formatPrice(balance.pending)} ·{' '}
                    <strong className="text-foreground">solde disponible {formatPrice(Math.max(available, 0))}</strong>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Montant versé (FCFA) *</Label>
              <Input id="pay-amount" inputMode="numeric" value={form.amount} onChange={(e) => set('amount', e.target.value)} aria-invalid={!!errors.amount} />
              {balance.status === 'ready' && available > 0 && (
                <button type="button" className="text-xs text-primary underline" onClick={() => set('amount', String(available))}>
                  Solder ({formatPrice(available)})
                </button>
              )}
              {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Moyen de paiement *</Label>
              <select
                id="pay-method"
                value={form.method}
                onChange={(e) => {
                  set('method', e.target.value);
                  set('confirmNow', false);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                aria-invalid={!!errors.method}
              >
                <option value="">Choisir…</option>
                {activeMethods.map((candidate) => (
                  <option key={candidate.code} value={candidate.code}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              {errors.method && <p className="text-xs text-destructive">{errors.method}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-reference">Référence de transaction{method?.requiresReference ? ' *' : ''}</Label>
              <Input id="pay-reference" value={form.reference} onChange={(e) => set('reference', e.target.value)} aria-invalid={!!errors.reference} />
              {errors.reference && <p className="text-xs text-destructive">{errors.reference}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Date du paiement *</Label>
              <Input id="pay-date" type="datetime-local" value={form.paidAt} onChange={(e) => set('paidAt', e.target.value)} aria-invalid={!!errors.paidAt} />
              {errors.paidAt && <p className="text-xs text-destructive">{errors.paidAt}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note interne (facultatif)</Label>
            <Textarea id="pay-note" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
            {errors.note && <p className="text-xs text-destructive">{errors.note}</p>}
          </div>

          {method && method.requiresVerification === false ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={form.confirmNow} onChange={(e) => set('confirmNow', e.target.checked)} />
              <span>
                <span className="block font-medium">J’atteste avoir reçu ces espèces : confirmer l’encaissement maintenant</span>
                <span className="block text-muted-foreground">Un reçu est alors émis. Sans cette case, le paiement reste en attente de confirmation.</span>
              </span>
            </label>
          ) : method ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Ce moyen doit être vérifié : le paiement sera enregistré « en attente de confirmation » et ne comptera comme encaissé qu’après votre confirmation explicite.
            </p>
          ) : null}

          {formError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer le paiement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmer / refuser / annuler / contrepasser                        */
/* ------------------------------------------------------------------ */

export type PaymentAction = 'confirm' | 'rejected' | 'cancelled' | 'reversed';

const ACTION_TEXT: Record<PaymentAction, { title: string; button: string; help: string }> = {
  confirm: { title: 'Confirmer le paiement', button: 'Confirmer l’encaissement', help: 'Un reçu sera émis et le montant comptera comme encaissé. Cette action est tracée.' },
  rejected: { title: 'Refuser le paiement', button: 'Refuser', help: 'Le paiement n’a pas été reçu ou est invalide. Il ne comptera jamais comme encaissé.' },
  cancelled: { title: 'Annuler la saisie', button: 'Annuler la saisie', help: 'Saisie faite par erreur. Le paiement reste visible dans l’historique.' },
  reversed: { title: 'Contrepasser un paiement confirmé', button: 'Contrepasser', help: 'Le paiement et son reçu restent dans l’historique, mais le montant n’est plus compté comme encaissé. Un motif est obligatoire.' },
};

interface ActionDialogProps {
  payment: PaymentRow | null;
  action: PaymentAction | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function PaymentActionDialog({ payment, action, onClose, onDone }: ActionDialogProps) {
  const [reason, setReason] = useState('');
  const [attest, setAttest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setReason('');
    setAttest(false);
    setError(null);
    setPending(false);
  }, [payment, action]);

  if (!payment || !action) return null;
  const text = ACTION_TEXT[action];

  async function run() {
    if (!payment || !action || pending) return;
    if (action === 'confirm' && !attest) return void setError('Cochez la case d’attestation pour confirmer.');
    if (action !== 'confirm' && reason.trim().length < (action === 'reversed' ? 5 : 3)) return void setError(`Indiquez un motif (${action === 'reversed' ? 5 : 3} caractères minimum).`);
    setError(null);
    setPending(true);
    const result = action === 'confirm' ? await confirmPayment(payment.id) : await setPaymentStatus(payment.id, action, reason);
    setPending(false);
    if (!result.ok) return void setError(result.message);
    onDone(action === 'confirm' ? `Paiement confirmé, reçu ${result.data.receiptNumber}. Solde restant : ${formatPrice(result.data.balance)}.` : `Paiement ${action === 'reversed' ? 'contrepassé' : action === 'rejected' ? 'refusé' : 'annulé'}. Il reste dans l’historique.`);
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>
            {payment.orderReference} · {payment.customerName} · {formatPrice(payment.amount)} · {payment.methodLabel}
            {payment.externalReference ? ` · ${payment.externalReference}` : ''}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{text.help}</p>
        {action === 'confirm' ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>
              J’atteste avoir <strong>vérifié</strong> la réception de {formatPrice(payment.amount)} ({payment.methodLabel}
              {payment.externalReference ? `, transaction ${payment.externalReference}` : ''}) sur le compte ou le support concerné.
            </span>
          </label>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="pay-reason">Motif *</Label>
            <Textarea id="pay-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Fermer
          </Button>
          <Button type="button" variant={action === 'confirm' ? 'default' : 'destructive'} disabled={pending} onClick={() => void run()}>
            {pending ? 'Traitement…' : text.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
