'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Check, Loader2, MessageCircle, Store, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DetailedCartLine } from '@/lib/cart';
import {
  createOrder,
  fetchCheckoutConfig,
  newIdempotencyKey,
  type CheckoutConfig,
  type OrderConfirmation,
  type ReceptionMode,
} from '@/lib/orders';
import { formatPrice } from '@/lib/products';
import { PAYMENT_METHOD, SITE, whatsappLink } from '@/lib/site';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Validation (confort de saisie : la base revalide tout)              */
/* ------------------------------------------------------------------ */

const phoneDigits = (value: string) => value.replace(/[\s.\-()]/g, '');
const isIvorianPhone = (value: string) => /^(\+?225)?\d{10}$/.test(phoneDigits(value));

const contactSchema = z.object({
  firstName: z.string().trim().min(2, 'Indiquez votre prénom.'),
  lastName: z.string().trim().min(2, 'Indiquez votre nom.'),
  phone: z.string().trim().refine(isIvorianPhone, 'Numéro invalide : 10 chiffres, avec ou sans +225.'),
  email: z.string().trim().email('Adresse email invalide.'),
});

const deliverySchema = z.object({
  commune: z.string().min(1, 'Choisissez une commune.'),
  address: z.string().trim().min(5, 'Indiquez une adresse de livraison complète.'),
  instructions: z.string().max(300, '300 caractères maximum.'),
});

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  commune: string;
  address: string;
  instructions: string;
  /** Champ piège (honeypot) : invisible pour les clients, rempli par les robots. */
  website: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

const INITIAL_FORM: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  commune: '',
  address: '',
  instructions: '',
  website: '',
};

/** Le retrait sur place ne demande aucune adresse : seule la livraison valide commune et adresse. */
function validate(step: number, form: FormState, mode: ReceptionMode): Errors {
  const schema = step === 1 ? contactSchema : step === 2 && mode === 'delivery' ? deliverySchema : null;
  if (!schema) return {};
  const result = schema.safeParse(form);
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof FormState;
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Composants                                                          */
/* ------------------------------------------------------------------ */

function Field({ id, label, error, optional, children }: { id: string; label: string; error?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(facultatif)</span>}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: DetailedCartLine[];
  totals: { subtotal: number };
  /** Appelé uniquement après l'enregistrement réel de la commande. */
  onClearCart: () => void;
}

const STEP_LABELS = ['Coordonnées', 'Réception', 'Récapitulatif'];

const RECEPTION_OPTIONS = [
  { id: 'delivery', label: 'Livraison à domicile', text: 'Nous vous livrons à l’adresse de votre choix.', icon: Truck },
  { id: 'pickup', label: 'Retrait sur place', text: 'Commandez en ligne et récupérez votre commande sur place.', icon: Store },
] as const;

type ConfigState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; config: CheckoutConfig };

export function CheckoutDialog({ open, onOpenChange, lines, totals, onClearCart }: CheckoutDialogProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [mode, setMode] = useState<ReceptionMode>('delivery');
  const [configState, setConfigState] = useState<ConfigState>({ status: 'loading' });
  const [configAttempt, setConfigAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Nouvelle ouverture : étapes remises à zéro, nouvelle clé d'idempotence (une clé par tentative de commande).
  useEffect(() => {
    if (open) {
      setStep(1);
      setErrors({});
      setSubmitError(null);
      setSubmitting(false);
      setConfirmation(null);
      setIdempotencyKey(newIdempotencyKey());
    }
  }, [open]);

  // Frais par commune et adresse de retrait : lus en base (aucun tarif n'est écrit dans le code).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConfigState({ status: 'loading' });
    fetchCheckoutConfig()
      .then((config) => !cancelled && setConfigState({ status: 'ready', config }))
      .catch(() => !cancelled && setConfigState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [open, configAttempt]);

  const config = configState.status === 'ready' ? configState.config : null;
  const communes = useMemo(() => config?.fees ?? [], [config]);
  const deliveryAvailable = communes.length > 0;

  // Sans tarif configuré (ou configuration illisible), seule l'option retrait reste proposée.
  useEffect(() => {
    if (configState.status !== 'loading' && !deliveryAvailable) setMode('pickup');
  }, [configState.status, deliveryAvailable]);
  useEffect(() => {
    if (communes.length > 0 && !communes.some((entry) => entry.commune === form.commune)) {
      setForm((current) => ({ ...current, commune: communes[0].commune }));
    }
  }, [communes, form.commune]);

  // Un panier vide sans confirmation à afficher ne doit pas laisser le dialogue ouvert.
  useEffect(() => {
    if (open && lines.length === 0 && !confirmation) onOpenChange(false);
  }, [open, lines.length, confirmation, onOpenChange]);

  const deliveryFee = mode === 'pickup' ? 0 : communes.find((entry) => entry.commune === form.commune)?.fee ?? 0;
  const total = totals.subtotal + deliveryFee;

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const fieldProps = (field: keyof FormState) => ({
    id: `checkout-${field}`,
    value: form[field],
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `checkout-${field}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(field, event.target.value),
  });

  const submitOrder = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await createOrder({
      idempotencyKey,
      customerName: `${form.firstName.trim()} ${form.lastName.trim()}`,
      email: form.email.trim(),
      phone: form.phone.trim(),
      mode,
      commune: form.commune,
      address: form.address.trim(),
      notes: form.instructions.trim(),
      items: lines.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      productNames: Object.fromEntries(lines.map(({ product }) => [product.id, product.name])),
      website: form.website,
    });
    setSubmitting(false);
    if (!result.ok) {
      if (result.code === 'REQUEST_REJECTED') {
        // Le champ piège contenait une valeur : presque toujours un remplissage automatique du navigateur. On le vide pour permettre une nouvelle tentative.
        setForm((current) => ({ ...current, website: '' }));
        setSubmitError('Un champ de sécurité invisible a été rempli automatiquement par votre navigateur. Nous l’avons vidé : cliquez de nouveau sur « Confirmer la commande ».');
        return;
      }
      setSubmitError(result.message);
      return;
    }
    // Succès réel : la base a renvoyé une commande complète. Le panier est vidé maintenant pour éviter toute double commande.
    setConfirmation(result.order);
    onClearCart();
  }, [submitting, idempotencyKey, form, mode, lines, onClearCart]);

  const goNext = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(step, form, mode);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (step < 3) setStep(step + 1);
    else void submitOrder();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && submitting) return; // pas de fermeture pendant l'enregistrement
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-y-auto p-0 sm:rounded-xl">
        {confirmation ? (
          <div className="space-y-6 p-6 sm:p-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
                <Check className="h-7 w-7" aria-hidden />
              </span>
              <DialogTitle className="font-display text-3xl font-semibold">Commande enregistrée</DialogTitle>
              <DialogDescription className="text-base">
                Merci {confirmation.customerName.split(' ')[0]}. Votre commande est enregistrée sous la référence{' '}
                <strong className="whitespace-nowrap text-foreground">{confirmation.reference}</strong>. Conservez-la.
              </DialogDescription>
            </div>

            <ul className="divide-y rounded-md border">
              {confirmation.items.map((item) => (
                <li key={`${item.name}-${item.unitPrice}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    {item.name} <span className="text-muted-foreground">× {item.quantity}</span>
                    {item.onDemand && (
                      <span className="block text-xs text-muted-foreground">
                        Sur commande{item.leadTime ? ` · délai indicatif : ${item.leadTime}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="font-medium">{formatPrice(item.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Sous-total</dt>
                <dd>{formatPrice(confirmation.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{confirmation.mode === 'pickup' ? 'Retrait sur place' : 'Livraison'}</dt>
                <dd>{formatPrice(confirmation.deliveryFee)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="text-primary">{formatPrice(confirmation.total)}</dd>
              </div>
            </dl>

            <section className="space-y-1 text-sm">
              <h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {confirmation.mode === 'pickup' ? 'Retrait sur place' : 'Livraison à domicile'}
              </h3>
              {confirmation.mode === 'pickup' ? (
                confirmation.pickupAddress ? (
                  <p>{confirmation.pickupAddress}</p>
                ) : (
                  <p className="text-muted-foreground">
                    Le lieu de retrait n’est pas encore indiqué sur ce site. Contactez {SITE.name} au {SITE.whatsappDisplay} pour le convenir.
                  </p>
                )
              ) : (
                <p>
                  {confirmation.address}, {confirmation.commune}
                </p>
              )}
            </section>
            <section className="space-y-1 text-sm">
              <h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">Paiement</h3>
              <p>
                <span className="font-medium">{PAYMENT_METHOD.label}</span> : en attente. Aucun paiement n’a été effectué en ligne.
              </p>
            </section>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button type="button" className="h-11" onClick={() => onOpenChange(false)}>
                Retour à la boutique
              </Button>
              <Button asChild variant="outline" className="h-11">
                <a href={whatsappLink(`Bonjour ${SITE.name}, je vous contacte au sujet de ma commande ${confirmation.reference}.`)} target="_blank" rel="noreferrer">
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                  Nous contacter (facultatif)
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={goNext} noValidate>
            <div className="space-y-4 border-b p-6 pr-14 sm:px-8">
              <DialogTitle className="font-display text-2xl font-semibold">Finaliser ma commande</DialogTitle>
              <DialogDescription className="sr-only">Formulaire de commande en trois étapes</DialogDescription>
              <ol className="flex items-center gap-2 text-xs sm:text-sm" aria-label="Étapes de la commande">
                {STEP_LABELS.map((label, index) => (
                  <li
                    key={label}
                    aria-current={step === index + 1 ? 'step' : undefined}
                    className={cn('flex flex-1 items-center gap-2', step >= index + 1 ? 'font-semibold text-primary' : 'text-muted-foreground')}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                        step > index + 1 && 'border-primary bg-primary text-primary-foreground',
                        step === index + 1 && 'border-primary'
                      )}
                    >
                      {step > index + 1 ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                    </span>
                    <span className={cn(step === index + 1 ? 'inline' : 'hidden sm:inline')}>{label}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-5 p-6 sm:px-8">
              {/* Honeypot : hors écran, ignoré des lecteurs d'écran et du clavier. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
                <label htmlFor="mh-trap">Ne pas remplir</label>
                {/* Nom volontairement neutre et attributs « ignorer » : ni le navigateur ni les gestionnaires de mots de passe ne doivent le remplir. */}
                <input
                  id="mh-trap"
                  name="mh-trap-7f3a"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  value={form.website}
                  onChange={(event) => update('website', event.target.value)}
                />
              </div>

              {step === 1 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="checkout-firstName" label="Prénom" error={errors.firstName}>
                    <Input {...fieldProps('firstName')} autoComplete="given-name" />
                  </Field>
                  <Field id="checkout-lastName" label="Nom" error={errors.lastName}>
                    <Input {...fieldProps('lastName')} autoComplete="family-name" />
                  </Field>
                  <Field id="checkout-phone" label="Téléphone" error={errors.phone}>
                    <Input {...fieldProps('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="07 00 00 00 00" />
                  </Field>
                  <Field id="checkout-email" label="Email" error={errors.email}>
                    <Input {...fieldProps('email')} type="email" autoComplete="email" placeholder="vous@exemple.com" />
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <fieldset className="space-y-3">
                    <legend className="mb-2 font-display text-lg font-semibold">Comment souhaitez-vous recevoir votre commande ?</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {RECEPTION_OPTIONS.map(({ id, label, text, icon: Icon }) => {
                        const disabled = id === 'delivery' && !deliveryAvailable;
                        return (
                          <label
                            key={id}
                            className={cn(
                              'flex items-start gap-3 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring',
                              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                              mode === id ? 'border-primary bg-accent' : !disabled && 'hover:bg-accent/50'
                            )}
                          >
                            <input
                              type="radio"
                              name="reception-mode"
                              value={id}
                              checked={mode === id}
                              disabled={disabled}
                              onChange={() => {
                                setMode(id);
                                setErrors({});
                              }}
                              className="sr-only"
                            />
                            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', mode === id ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                            <span className="space-y-1">
                              <span className="block font-medium">{label}</span>
                              <span className="block text-sm text-muted-foreground">{text}</span>
                              <span className="block text-sm font-medium">
                                {id === 'pickup'
                                  ? 'Pas de frais de livraison'
                                  : disabled
                                    ? configState.status === 'loading'
                                      ? 'Chargement des tarifs…'
                                      : 'Indisponible pour le moment'
                                    : 'Frais selon la commune'}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  {configState.status === 'error' && (
                    <p role="alert" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      Les tarifs de livraison n’ont pas pu être chargés.{' '}
                      <button type="button" className="font-medium text-primary underline" onClick={() => setConfigAttempt((n) => n + 1)}>
                        Réessayer
                      </button>
                    </p>
                  )}
                  {configState.status === 'ready' && !deliveryAvailable && (
                    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      La livraison n’est pas encore disponible : aucun tarif n’est configuré. Le retrait sur place reste possible.
                    </p>
                  )}

                  {mode === 'pickup' && (
                    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      {config?.pickupAddress ? (
                        <>Lieu de retrait : {config.pickupAddress}</>
                      ) : (
                        <>
                          Le lieu de retrait n’est pas encore défini sur ce site. Contactez {SITE.name} au {SITE.whatsappDisplay} pour le convenir.
                        </>
                      )}
                    </p>
                  )}

                  {mode === 'delivery' && deliveryAvailable && (
                    <>
                      <Field id="checkout-commune" label="Commune" error={errors.commune}>
                        <select
                          id="checkout-commune"
                          value={form.commune}
                          onChange={(event) => update('commune', event.target.value)}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {communes.map(({ commune, fee }) => (
                            <option key={commune} value={commune}>
                              {commune} — {formatPrice(fee)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="checkout-address" label="Adresse complète" error={errors.address}>
                        <Textarea {...fieldProps('address')} rows={3} autoComplete="street-address" placeholder="Rue, quartier, repère…" />
                      </Field>
                      <Field id="checkout-instructions" label="Instructions de livraison" error={errors.instructions} optional>
                        <Textarea {...fieldProps('instructions')} rows={2} placeholder="Ex. : appeler avant d’arriver" />
                      </Field>
                    </>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <section aria-labelledby="recap-articles" className="space-y-3">
                    <h3 id="recap-articles" className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Vos articles
                    </h3>
                    <ul className="divide-y rounded-md border">
                      {lines.map(({ product, quantity, lineTotal }) => (
                        <li key={product.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <span>
                            {product.name} <span className="text-muted-foreground">× {quantity}</span>
                          </span>
                          <span className="font-medium">{formatPrice(lineTotal)}</span>
                        </li>
                      ))}
                    </ul>
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Sous-total</dt>
                        <dd>{formatPrice(totals.subtotal)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">{mode === 'pickup' ? 'Retrait sur place' : 'Livraison'}</dt>
                        <dd>{formatPrice(deliveryFee)}</dd>
                      </div>
                      <div className="flex justify-between border-t pt-2 text-base font-semibold">
                        <dt>Total</dt>
                        <dd className="text-primary">{formatPrice(total)}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground">Les prix et frais définitifs sont recalculés à l’enregistrement de la commande.</p>
                  </section>

                  <section aria-labelledby="recap-delivery" className="space-y-1 text-sm">
                    <h3 id="recap-delivery" className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {mode === 'pickup' ? 'Contact et retrait' : 'Contact et livraison'}
                    </h3>
                    <p>
                      {form.firstName.trim()} {form.lastName.trim()} · {form.phone.trim()} · {form.email.trim()}
                    </p>
                    {mode === 'pickup' ? (
                      <p>{config?.pickupAddress ? `Retrait sur place : ${config.pickupAddress}` : `Retrait sur place : le lieu est à convenir avec ${SITE.name}.`}</p>
                    ) : (
                      <>
                        <p>
                          {form.address.trim()}, {form.commune}
                        </p>
                        {form.instructions.trim() && <p className="text-muted-foreground">{form.instructions.trim()}</p>}
                      </>
                    )}
                  </section>

                  <section aria-labelledby="recap-payment" className="space-y-1 text-sm">
                    <h3 id="recap-payment" className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Mode de paiement
                    </h3>
                    <p className="font-medium">{PAYMENT_METHOD.label}</p>
                    <p className="text-muted-foreground">Vous réglez à la réception de votre commande. Aucun paiement n’est traité en ligne.</p>
                  </section>

                  {submitError && (
                    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      {submitError}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t p-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              {step > 1 ? (
                <Button type="button" variant="ghost" className="h-11 sm:h-10" disabled={submitting} onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                  Retour
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="lg" className="h-11 w-full px-6 sm:w-auto" disabled={submitting || (step === 2 && configState.status === 'loading')}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Enregistrement…
                  </>
                ) : step === 3 ? (
                  'Confirmer la commande'
                ) : (
                  <>
                    Continuer
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
