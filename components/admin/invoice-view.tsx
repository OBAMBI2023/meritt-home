'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/admin/admin-ui';
import { BrandLogo } from '@/components/shop/brand-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAdminQuery } from '@/hooks/use-admin-query';
import {
  DISPLAY_LABELS,
  EVENT_LABELS,
  cancelInvoice,
  draftFormSchema,
  fetchInvoiceById,
  fetchInvoiceEvents,
  fetchInvoiceLines,
  isInvoiceModuleMissing,
  issueInvoice,
  updateInvoiceDraft,
  type DraftFormInput,
  type InvoiceEvent,
  type InvoiceLine,
  type InvoiceRow,
} from '@/lib/admin/invoices';
import { fetchOrderPayments, STATUS_LABELS as PAYMENT_STATUS_LABELS, type PaymentRow } from '@/lib/admin/payments';
import { downloadInvoicePdf } from '@/lib/pdf/download';
import { formatPrice } from '@/lib/products';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

interface Loaded {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  events: InvoiceEvent[];
  payments: PaymentRow[];
}

/* ------------------------------------------------------------------ */
/* Dialogues                                                           */
/* ------------------------------------------------------------------ */

function EditDraftDialog({ invoice, open, onClose, onDone }: { invoice: InvoiceRow; open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<DraftFormInput>({ customerName: '', customerEmail: '', customerPhone: '', billingAddress: '', dueAt: '', notes: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof DraftFormInput, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ customerName: invoice.customerName, customerEmail: invoice.customerEmail ?? '', customerPhone: invoice.customerPhone ?? '', billingAddress: invoice.billingAddress ?? '', dueAt: invoice.dueAt ?? '', notes: invoice.notes ?? '' });
    setErrors({});
    setError(null);
    setPending(false);
  }, [open, invoice]);
  const set = (key: keyof DraftFormInput, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (pending) return;
    const parsed = draftFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof DraftFormInput, string>> = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof DraftFormInput] ??= issue.message;
      return void setErrors(next);
    }
    setErrors({});
    setError(null);
    setPending(true);
    const result = await updateInvoiceDraft(invoice.id, parsed.data);
    setPending(false);
    if (!result.ok) return void setError(result.message);
    toast.success('Brouillon enregistré.');
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier le brouillon</DialogTitle>
          <DialogDescription>Seules l’identité de facturation, l’échéance et la note sont modifiables. Les articles et les montants viennent de la commande et ne se modifient jamais.</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {([
            ['customerName', 'Nom du client *', 'text'],
            ['customerEmail', 'E-mail', 'email'],
            ['customerPhone', 'Téléphone', 'tel'],
            ['dueAt', 'Date d’échéance', 'date'],
          ] as const).map(([key, label, type]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`draft-${key}`}>{label}</Label>
              <Input id={`draft-${key}`} type={type} value={form[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key]} />
              {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="draft-billingAddress">Adresse de facturation</Label>
            <Textarea id="draft-billingAddress" rows={2} value={form.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} />
            {errors.billingAddress && <p className="text-xs text-destructive">{errors.billingAddress}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-notes">Note imprimée sur la facture</Label>
            <Textarea id="draft-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
          </div>
          {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ open, title, description, confirmLabel, destructive, withReason, onClose, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean; withReason?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function run() {
    if (pending) return;
    if (withReason && reason.trim().length < 5) return void setError('Indiquez un motif d’au moins 5 caractères.');
    setError(null);
    setPending(true);
    const message = await onConfirm(reason);
    setPending(false);
    if (message) setError(message);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {withReason && (
          <div className="space-y-1.5">
            <Label htmlFor="inv-reason">Motif *</Label>
            <Textarea id="inv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Fermer</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={pending} onClick={() => void run()}>{pending ? 'Traitement…' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page facture                                                        */
/* ------------------------------------------------------------------ */

export function InvoiceView() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const autoPrint = params.get('print') === '1';
  const load = useCallback(async (): Promise<Loaded | null> => {
    if (!UUID.test(id)) return null;
    const invoice = await fetchInvoiceById(id);
    if (!invoice) return null;
    const [lines, events, payments] = await Promise.all([fetchInvoiceLines(id), fetchInvoiceEvents(id), fetchOrderPayments(invoice.orderId)]);
    return { invoice, lines, events, payments };
  }, [id]);
  const { state, reload } = useAdminQuery(load);
  const [dialog, setDialog] = useState<'edit' | 'issue' | 'cancel' | null>(null);
  const [downloading, setDownloading] = useState(false);

  const loaded = state.status === 'ready' ? state.data : null;

  // Le nom de fichier proposé par « Enregistrer au format PDF » est le numéro de facture.
  useEffect(() => {
    const number = loaded?.invoice.number;
    if (!number) return;
    const before = document.title;
    const onBefore = () => { document.title = number; };
    const onAfter = () => { document.title = before; };
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, [loaded?.invoice.number]);
  useEffect(() => {
    if (autoPrint && loaded) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, loaded]);

  async function pdf(invoice: InvoiceRow) {
    setDownloading(true);
    try {
      await downloadInvoicePdf(invoice);
    } catch {
      toast.error('Le PDF n’a pas pu être généré.');
    } finally {
      setDownloading(false);
    }
  }

  const invoice = loaded?.invoice ?? null;
  const company = invoice?.company ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Toaster position="top-center" richColors closeButton />
      <style>{'@page { size: A4; margin: 14mm; }'}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/factures">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Factures
          </Link>
        </Button>
        {invoice && (
          <div className="flex flex-wrap gap-2">
            {invoice.status === 'draft' && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => setDialog('edit')}>Modifier</Button>
                <Button type="button" size="sm" onClick={() => setDialog('issue')}>Émettre la facture</Button>
              </>
            )}
            {invoice.status !== 'cancelled' && (
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog('cancel')}>{invoice.status === 'draft' ? 'Abandonner le brouillon' : 'Annuler la facture'}</Button>
            )}
            <Button type="button" size="sm" variant="outline" disabled={downloading} onClick={() => void pdf(invoice)}>
              <FileDown className="mr-2 h-4 w-4" aria-hidden />
              Télécharger le PDF
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" aria-hidden />
              Imprimer
            </Button>
          </div>
        )}
      </div>

      {state.status === 'loading' && <LoadingBlock label="Chargement de la facture…" />}
      {state.status === 'error' && (isInvoiceModuleMissing(state.code) ? <EmptyState title="Module de facturation non installé" text="Appliquez migration-encaissements.sql puis migration-factures.sql dans Supabase." /> : <ErrorBlock code={state.code} onRetry={reload} />)}
      {state.status === 'ready' && state.data === null && <EmptyState title="Facture introuvable" text="Cette facture n’existe pas ou vous n’avez pas le droit de la consulter." />}

      {loaded && invoice && (
        <>
          <article className="space-y-6 rounded-lg border bg-card p-6 text-sm print:rounded-none print:border-0 print:p-0 sm:p-8" aria-label={`Facture ${invoice.number ?? 'brouillon'}`}>
            <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
              <div className="space-y-1">
                <BrandLogo />
                {company?.company_name && <p className="font-medium">{company.company_name}</p>}
                {company?.address && <p className="text-xs text-muted-foreground">{company.address}</p>}
                {(company?.phone || company?.email) && <p className="text-xs text-muted-foreground">{[company.phone, company.email].filter(Boolean).join(' · ')}</p>}
                {(company?.tax_id || company?.rccm) && <p className="text-xs text-muted-foreground">{[company.tax_id && `N° fiscal : ${company.tax_id}`, company.rccm && `RCCM : ${company.rccm}`].filter(Boolean).join(' · ')}</p>}
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-semibold">Facture</p>
                <p className="font-medium">{invoice.number ?? 'BROUILLON'}</p>
                <Badge variant={invoice.displayStatus === 'paid' ? 'default' : invoice.displayStatus === 'overdue' || invoice.displayStatus === 'cancelled' ? 'destructive' : 'outline'} className="mt-1">
                  {DISPLAY_LABELS[invoice.displayStatus]}
                </Badge>
              </div>
            </header>

            {invoice.status === 'draft' && <p className="rounded-md border-2 border-destructive p-2 text-center text-xs font-semibold uppercase tracking-wide text-destructive">Brouillon : document non valable tant que la facture n’est pas émise</p>}
            {invoice.status === 'cancelled' && (
              <p className="rounded-md border-2 border-destructive p-2 text-center text-xs font-semibold text-destructive">
                FACTURE ANNULÉE le {day(invoice.cancelledAt)}{invoice.cancelReason ? ` : ${invoice.cancelReason}` : ''}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <section aria-labelledby="bill-to">
                <h3 id="bill-to" className="mb-1 font-sans text-xs font-semibold uppercase tracking-wider text-muted-foreground">Facturé à</h3>
                <p className="font-medium">{invoice.customerName}</p>
                {invoice.billingAddress && <p>{invoice.billingAddress}</p>}
                {invoice.customerPhone && <p>Tél. : {invoice.customerPhone}</p>}
                {invoice.customerEmail && <p>{invoice.customerEmail}</p>}
              </section>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Date d’émission</dt><dd>{day(invoice.issuedAt)}</dd>
                <dt className="text-muted-foreground">Échéance</dt><dd>{day(invoice.dueAt)}</dd>
                <dt className="text-muted-foreground">Commande</dt><dd className="font-medium">{invoice.orderReference}</dd>
                <dt className="text-muted-foreground">Réception</dt><dd>{invoice.fulfillmentMethod === 'pickup' ? 'Retrait sur place' : 'Livraison à domicile'}</dd>
                {invoice.replacesNumber && (<><dt className="text-muted-foreground">Remplace</dt><dd>{invoice.replacesNumber} (annulée)</dd></>)}
              </dl>
            </div>

            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-y bg-muted/50 text-xs">
                  <th className="px-2 py-2 font-semibold">Désignation</th>
                  <th className="px-2 py-2 text-right font-semibold">Qté</th>
                  <th className="px-2 py-2 text-right font-semibold">Prix unitaire</th>
                  <th className="px-2 py-2 text-right font-semibold">Montant</th>
                </tr>
              </thead>
              <tbody>
                {loaded.lines.map((line) => (
                  <tr key={line.position} className="break-inside-avoid border-b">
                    <td className="px-2 py-2">{line.description}</td>
                    <td className="px-2 py-2 text-right">{line.quantity}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatPrice(line.unitPrice)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatPrice(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="ml-auto w-full max-w-xs space-y-1 break-inside-avoid">
              <div className="flex justify-between"><dt className="text-muted-foreground">Sous-total</dt><dd>{formatPrice(invoice.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{invoice.fulfillmentMethod === 'pickup' ? 'Retrait sur place' : 'Frais de livraison'}</dt><dd>{formatPrice(invoice.deliveryFee)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd>{formatPrice(invoice.total)}</dd></div>
              {invoice.status === 'issued' && (
                <>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Déjà encaissé</dt><dd>{formatPrice(invoice.paid)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>Solde restant</dt><dd>{formatPrice(Math.max(invoice.balance, 0))}</dd></div>
                </>
              )}
            </dl>

            {(company?.payment_terms || invoice.notes || company?.legal_notice) && (
              <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
                {company?.payment_terms && <p><span className="font-semibold uppercase tracking-wide">Conditions de paiement : </span>{company.payment_terms}</p>}
                {invoice.notes && <p><span className="font-semibold uppercase tracking-wide">Note : </span>{invoice.notes}</p>}
                {company?.legal_notice && <p>{company.legal_notice}</p>}
              </div>
            )}
          </article>

          <section aria-labelledby="inv-payments" className="space-y-2 rounded-lg border bg-card p-4 text-sm print:hidden">
            <div className="flex items-center justify-between gap-2">
              <h3 id="inv-payments" className="font-sans text-sm font-semibold">Règlement (paiements confirmés de la commande)</h3>
              <Link href="/admin/encaissements" className="text-xs text-primary underline">Gérer les encaissements</Link>
            </div>
            {invoice.status !== 'issued' ? (
              <p className="text-muted-foreground">Le règlement n’est suivi que pour les factures émises.</p>
            ) : (
              <>
                <p>Encaissé : <span className="font-medium">{formatPrice(invoice.paid)}</span> sur {formatPrice(invoice.total)} · solde restant : <span className="font-medium">{formatPrice(Math.max(invoice.balance, 0))}</span></p>
                {loaded.payments.length === 0 ? (
                  <p className="text-muted-foreground">Aucun paiement enregistré pour cette commande.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {loaded.payments.map((payment) => (
                      <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span>{formatPrice(payment.amount)} · {payment.methodLabel}<span className="block text-xs text-muted-foreground">{dateTime(payment.paidAt)}{payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}</span></span>
                        <Badge variant={payment.status === 'confirmed' ? 'default' : 'outline'}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">Seuls les paiements confirmés comptent. Une commande livrée n’est pas forcément payée.</p>
              </>
            )}
          </section>

          <section aria-labelledby="inv-history" className="space-y-2 rounded-lg border bg-card p-4 text-sm print:hidden">
            <h3 id="inv-history" className="font-sans text-sm font-semibold">Historique</h3>
            <ul className="space-y-1">
              {loaded.events.map((event, index) => (
                <li key={index} className="flex flex-wrap justify-between gap-2">
                  <span>{EVENT_LABELS[event.event] ?? event.event}{event.reason ? ` : ${event.reason}` : ''}</span>
                  <span className="text-xs text-muted-foreground">{dateTime(event.createdAt)}{event.actorEmail ? ` · ${event.actorEmail}` : ''}</span>
                </li>
              ))}
            </ul>
          </section>

          <EditDraftDialog invoice={invoice} open={dialog === 'edit'} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
          <ConfirmDialog
            open={dialog === 'issue'}
            title="Émettre la facture"
            description="Le numéro est attribué maintenant et les coordonnées de l’entreprise sont figées. Une facture émise ne peut plus être modifiée : seule une annulation motivée est possible."
            confirmLabel="Émettre la facture"
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              const result = await issueInvoice(invoice.id);
              if (!result.ok) return result.message;
              toast.success(`Facture ${result.data.number} émise.`);
              setDialog(null);
              reload();
              return null;
            }}
          />
          <ConfirmDialog
            open={dialog === 'cancel'}
            title={invoice.status === 'draft' ? 'Abandonner le brouillon' : 'Annuler la facture'}
            description="La facture reste dans l’historique avec son numéro et le motif : rien n’est supprimé et le numéro n’est jamais réutilisé. Pour corriger, créez ensuite une nouvelle facture : elle référencera celle-ci."
            confirmLabel={invoice.status === 'draft' ? 'Abandonner' : 'Annuler la facture'}
            destructive
            withReason
            onClose={() => setDialog(null)}
            onConfirm={async (reason) => {
              const result = await cancelInvoice(invoice.id, reason);
              if (!result.ok) return result.message;
              toast.success('Facture annulée. Elle reste consultable dans l’historique.');
              setDialog(null);
              reload();
              return null;
            }}
          />
        </>
      )}
    </div>
  );
}
