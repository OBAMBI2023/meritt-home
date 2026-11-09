'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, MessageCircle, Printer } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, LoadingBlock } from '@/components/admin/admin-ui';
import { ModuleDiagnostic, StatusBadge, formatDate, formatDateTime } from '@/components/admin/sections/custom-requests-section';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAdminQuery } from '@/hooks/use-admin-query';
import {
  EVENT_LABELS,
  STATUSES,
  STATUS_LABELS,
  addNote,
  convertToOrder,
  fetchCustomRequestDetail,
  updateRequest,
  type CustomRequestDetail,
  type CustomStatus,
} from '@/lib/admin/custom-requests';
import { BUDGET_RANGES, CONTACT_METHODS, DEADLINE_KINDS, INSPIRATION_SOURCES, PROJECT_TYPES, formatBytes, labelOf } from '@/lib/custom-requests';
import { formatPrice } from '@/lib/products';
import { whatsappLink } from '@/lib/site';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[170px_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line break-words font-medium">{value}</dd>
    </div>
  );
}

/** Seuls les liens https sont rendus cliquables (la base les impose déjà ; contrôle redondant volontaire). */
function SafeLink({ url }: { url: string }) {
  if (!/^https:\/\/\S+$/.test(url)) return <span className="break-all">{url}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-primary underline-offset-4 hover:underline">
      {url}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  );
}

function describeEvent(event: CustomRequestDetail['events'][number]): string {
  const base = EVENT_LABELS[event.event] ?? event.event;
  if (event.event === 'status_changed') {
    const label = (value: string | null) => (value && value in STATUS_LABELS ? STATUS_LABELS[value as CustomStatus] : (value ?? '—'));
    return `${base} : ${label(event.from)} → ${label(event.to)}`;
  }
  if (event.event === 'assigned') return `${base} : ${event.from ?? 'personne'} → ${event.to ?? 'personne'}`;
  if (event.event === 'quote_set') {
    const money = (value: string | null) => (value === null ? '—' : formatPrice(Number(value)));
    return `${base} : ${money(event.from)} → ${money(event.to)}`;
  }
  if (event.event === 'converted') return `${base} (${event.to ?? ''})`;
  return base;
}

function ConvertDialog({ detail, onClose, onDone }: { detail: CustomRequestDetail; onClose: () => void; onDone: () => void }) {
  const { request } = detail;
  const [label, setLabel] = useState(`Création sur mesure ${request.reference}`);
  const [commune, setCommune] = useState(request.commune ?? '');
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delivery = commune.trim() !== '' && address.trim() !== '';

  async function run() {
    setPending(true);
    setError(null);
    const result = await convertToOrder(request.id, label.trim(), commune.trim(), address.trim());
    setPending(false);
    if (!result.ok) return setError(result.message);
    toast.success(result.data ? `Commande ${result.data.orderReference} créée (en attente).` : 'Commande créée.');
    onDone();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convertir en commande</DialogTitle>
          <DialogDescription>
            Crée une commande « en attente » de {formatPrice(request.quoteAmount ?? 0)} (montant du devis) pour {request.name}. Aucun stock n’est modifié, aucune facture ni aucun paiement n’est créé. Cette action ne peut être faite qu’une seule fois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cv-label">Libellé de la ligne de commande *</Label>
            <Input id="cv-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} />
          </div>
          <p className="text-xs text-muted-foreground">Livraison : renseignez la commune ET l’adresse. Sinon la commande est créée en retrait sur place. Aucun frais de livraison n’est ajouté (inclus au devis).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-commune">Commune</Label>
              <Input id="cv-commune" value={commune} onChange={(event) => setCommune(event.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-address">Adresse</Label>
              <Input id="cv-address" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} />
            </div>
          </div>
          <p className="text-sm font-medium">Mode : {delivery ? 'livraison' : 'retrait sur place'}</p>
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
          <Button type="button" disabled={pending || label.trim().length < 3} onClick={() => void run()}>
            {pending ? 'Création…' : 'Créer la commande'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tracking({ detail, onSaved }: { detail: CustomRequestDetail; onSaved: () => void }) {
  const { request } = detail;
  const [status, setStatus] = useState<CustomStatus>(request.status);
  const [assignee, setAssignee] = useState(request.assignedTo ?? '');
  const [quote, setQuote] = useState(request.quoteAmount === null ? '' : String(request.quoteAmount));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quoteValid = quote.trim() === '' || (/^\d+$/.test(quote.trim()) && Number(quote.trim()) <= 2_000_000_000);
  const dirty = status !== request.status || assignee.trim() !== (request.assignedTo ?? '') || quote.trim() !== (request.quoteAmount === null ? '' : String(request.quoteAmount));

  async function save() {
    setPending(true);
    setError(null);
    const result = await updateRequest(request.id, status, assignee.trim(), quote.trim() === '' ? null : Number(quote.trim()));
    setPending(false);
    if (!result.ok) return setError(result.message);
    toast.success('Suivi enregistré.');
    onSaved();
  }

  return (
    <section aria-labelledby="cr-tracking" className="space-y-3 rounded-lg border bg-card p-4 print:hidden">
      <h3 id="cr-tracking" className="font-sans text-base font-semibold">
        Suivi
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="tr-status">Statut</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as CustomStatus)}>
            <SelectTrigger id="tr-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tr-assignee">Responsable</Label>
          <Input id="tr-assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)} maxLength={80} placeholder="Nom de la personne" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tr-quote">Montant du devis (FCFA)</Label>
          <Input id="tr-quote" inputMode="numeric" value={quote} onChange={(event) => setQuote(event.target.value)} aria-invalid={!quoteValid || undefined} />
          {!quoteValid && <p className="text-xs text-destructive">Nombre entier de FCFA, sans décimales.</p>}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" disabled={!dirty || !quoteValid || pending} onClick={() => void save()}>
        {pending ? 'Enregistrement…' : 'Enregistrer le suivi'}
      </Button>
    </section>
  );
}

function Notes({ detail, onSaved }: { detail: CustomRequestDetail; onSaved: () => void }) {
  const [kind, setKind] = useState<'note' | 'exchange'>('note');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setPending(true);
    setError(null);
    const result = await addNote(detail.request.id, kind, body.trim());
    setPending(false);
    if (!result.ok) return setError(result.message);
    setBody('');
    onSaved();
  }

  return (
    <section aria-labelledby="cr-notes" className="space-y-3 rounded-lg border bg-card p-4 print:hidden">
      <h3 id="cr-notes" className="font-sans text-base font-semibold">
        Notes internes et échanges
      </h3>
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="nt-kind">Type</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as 'note' | 'exchange')}>
            <SelectTrigger id="nt-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Note interne</SelectItem>
              <SelectItem value="exchange">Échange avec le client</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nt-body">Message</Label>
          <Textarea id="nt-body" rows={3} value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" disabled={pending || body.trim() === ''} onClick={() => void add()}>
        {pending ? 'Ajout…' : 'Ajouter'}
      </Button>
      {detail.notes.length > 0 && (
        <ul className="divide-y rounded-md border">
          {detail.notes.map((note) => (
            <li key={note.id} className="space-y-1 p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {note.kind === 'exchange' ? 'Échange' : 'Note interne'} · {formatDateTime(note.createdAt)}
                {note.author ? ` · ${note.author}` : ''}
              </p>
              <p className="whitespace-pre-line break-words">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function View({ detail, reload, autoPrint }: { detail: CustomRequestDetail; reload: () => void; autoPrint: boolean }) {
  const { request, images, events } = detail;
  const [converting, setConverting] = useState(false);
  const canConvert = request.status === 'accepted' && request.convertedOrderId === null && (request.quoteAmount ?? 0) > 0;

  // Le nom de fichier proposé par « Enregistrer au format PDF » est la référence de la demande.
  useEffect(() => {
    const before = document.title;
    const onBefore = () => {
      document.title = request.reference;
    };
    const onAfter = () => {
      document.title = before;
    };
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, [request.reference]);

  useEffect(() => {
    if (!autoPrint) return;
    // On attend le chargement des aperçus avant d'imprimer.
    const timer = setTimeout(() => window.print(), 1200);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  const dimensions = [request.width && `L ${request.width}`, request.height && `H ${request.height}`, request.depth && `P ${request.depth}`].filter(Boolean).join(' × ');
  const deadline = request.deadlineKind === 'custom_date' && request.deadlineDate ? `Avant le ${formatDate(request.deadlineDate)}` : labelOf(DEADLINE_KINDS, request.deadlineKind);
  const waMessage = `Bonjour ${request.name}, ici Meritt Home. Au sujet de votre demande de création sur mesure ${request.reference}.`;
  const waNumber = request.phone.replace(/\D/g, '');

  return (
    <div className="space-y-4">
      <article className="space-y-5 rounded-lg border bg-card p-4 text-sm print:rounded-none print:border-0 print:p-0 sm:p-6" aria-label={`Demande ${request.reference}`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Meritt Home · Création sur mesure</p>
            <h2 className="font-display text-2xl font-semibold">{request.reference}</h2>
            <p className="text-muted-foreground">Reçue le {formatDateTime(request.createdAt)}</p>
          </div>
          <StatusBadge status={request.status} />
        </header>

        <dl className="divide-y">
          <Row label="Client" value={request.name} />
          <Row label="Téléphone / WhatsApp" value={request.phone} />
          <Row label="E-mail" value={request.email} />
          <Row label="Commune / quartier" value={request.commune} />
          <Row label="Contact préféré" value={labelOf(CONTACT_METHODS, request.contact)} />
          <Row label="Nature du projet" value={labelOf(PROJECT_TYPES, request.projectType)} />
          <Row label="Source d’inspiration" value={request.source ? labelOf(INSPIRATION_SOURCES, request.source) : null} />
          {request.referenceUrl && (
            <div className="grid gap-0.5 py-2 sm:grid-cols-[170px_1fr] sm:gap-4">
              <dt className="text-muted-foreground">Lien de référence</dt>
              <dd className="font-medium">
                <SafeLink url={request.referenceUrl} />
              </dd>
            </div>
          )}
          <Row label="Description" value={request.description} />
          <Row label="Dimensions (cm)" value={dimensions || null} />
          <Row label="Matériaux" value={request.materials} />
          <Row label="Couleurs" value={request.colors} />
          <Row label="Finitions" value={request.finishes} />
          <Row label="Quantité" value={String(request.quantity)} />
          <Row label="Contraintes" value={request.constraints} />
          <Row label="Budget estimatif" value={labelOf(BUDGET_RANGES, request.budget)} />
          <Row label="Délai souhaité" value={deadline} />
          <Row label="Responsable" value={request.assignedTo} />
          <Row label="Montant du devis" value={request.quoteAmount === null ? null : formatPrice(request.quoteAmount)} />
          <Row label="Commande" value={detail.orderReference} />
        </dl>

        {images.length > 0 && (
          <section aria-labelledby="cr-images" className="space-y-2">
            <h3 id="cr-images" className="font-sans text-base font-semibold">
              Images jointes ({images.length})
            </h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
              {images.map((image) => (
                <li key={image.id} className="space-y-1">
                  {image.url ? (
                    <a href={image.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border bg-muted">
                      {/* URL signée à durée limitée : l'optimiseur d'images de Next ne doit pas la mettre en cache. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={image.kind === 'space' ? 'Photo de l’espace du client' : 'Image d’inspiration'} className="aspect-square w-full object-cover" loading="lazy" />
                    </a>
                  ) : (
                    <div className="flex aspect-square items-center justify-center rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">Image indisponible</div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {image.kind === 'space' ? 'Espace du client' : 'Inspiration'} · {formatBytes(image.size)}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground print:hidden">Les liens d’images expirent au bout d’une heure : rechargez la page pour en obtenir de nouveaux.</p>
          </section>
        )}
      </article>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button asChild variant="outline" size="sm">
          <a href={whatsappLink(waMessage).replace(/wa\.me\/\d+/, `wa.me/${waNumber}`)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
            Écrire au client sur WhatsApp
          </a>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" aria-hidden />
          Exporter en PDF
        </Button>
        {canConvert && (
          <Button type="button" size="sm" onClick={() => setConverting(true)}>
            Convertir en commande
          </Button>
        )}
      </div>
      {request.status === 'accepted' && request.convertedOrderId === null && !canConvert && (
        <p className="text-sm text-muted-foreground print:hidden">Pour convertir cette demande en commande, renseignez et enregistrez d’abord le montant du devis.</p>
      )}

      <Tracking key={`${request.status}-${request.assignedTo}-${request.quoteAmount}`} detail={detail} onSaved={reload} />
      <Notes detail={detail} onSaved={reload} />

      <section aria-labelledby="cr-history" className="space-y-2 rounded-lg border bg-card p-4 text-sm print:hidden">
        <h3 id="cr-history" className="font-sans text-base font-semibold">
          Historique
        </h3>
        <ul className="divide-y">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>{describeEvent(event)}</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)}
                {event.actor ? ` · ${event.actor}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {converting && (
        <ConvertDialog
          detail={detail}
          onClose={() => setConverting(false)}
          onDone={() => {
            setConverting(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

export function CustomRequestView() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const autoPrint = params.get('print') === '1';
  const load = useCallback(async () => (UUID.test(id) ? fetchCustomRequestDetail(id) : null), [id]);
  const { state, reload } = useAdminQuery(load);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Toaster position="top-center" richColors closeButton />
      <style>{'@page { size: A4; margin: 14mm; }'}</style>
      <div className="print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/sur-mesure">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Demandes sur mesure
          </Link>
        </Button>
      </div>
      {state.status === 'loading' && <LoadingBlock label="Chargement de la demande…" />}
      {state.status === 'error' && <ModuleDiagnostic code={state.code} onRetry={reload} />}
      {state.status === 'ready' && state.data === null && <EmptyState title="Demande introuvable" text="Cette demande n’existe pas ou vous n’avez pas le droit de la consulter." />}
      {state.status === 'ready' && state.data && <View detail={state.data} reload={reload} autoPrint={autoPrint} />}
    </div>
  );
}
