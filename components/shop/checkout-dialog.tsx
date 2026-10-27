'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Check, Info, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DetailedCartLine } from '@/lib/cart';
import { formatPrice } from '@/lib/products';
import { DELIVERY, PAYMENT_METHOD, SITE, whatsappLink } from '@/lib/site';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Validation                                                          */
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
  commune: z.string().refine((value) => (DELIVERY.communes as readonly string[]).includes(value), 'Choisissez une commune.'),
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
}

type Errors = Partial<Record<keyof FormState, string>>;

const INITIAL_FORM: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  commune: DELIVERY.communes[0],
  address: '',
  instructions: '',
};

function validate(step: number, form: FormState): Errors {
  const schema = step === 1 ? contactSchema : step === 2 ? deliverySchema : null;
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
  totals: { subtotal: number; delivery: number; total: number };
  onClearCart: () => void;
}

const STEP_LABELS = ['Coordonnées', 'Livraison', 'Récapitulatif'];

export function CheckoutDialog({ open, onOpenChange, lines, totals, onClearCart }: CheckoutDialogProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setErrors({});
      setFinished(false);
    }
  }, [open]);

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

  const goNext = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(step, form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (step < 3) setStep(step + 1);
    // Séparation volontaire : aucune soumission serveur n'existe encore.
    // Le branchement futur (enregistrement de la commande) se fera ici.
    else setFinished(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-y-auto p-0 sm:rounded-xl">
        {finished ? (
          <div className="flex flex-col items-center gap-4 p-8 text-center sm:p-12">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
              <Check className="h-7 w-7" aria-hidden />
            </span>
            <DialogTitle className="font-display text-3xl font-semibold">Simulation terminée</DialogTitle>
            <DialogDescription className="max-w-md text-base leading-relaxed">
              Merci {form.firstName.trim()}. Cette commande était une démonstration : <strong>rien n’a été enregistré, transmis ni payé.</strong>{' '}
              Pour commander, contactez {SITE.name} directement.
            </DialogDescription>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button asChild className="h-11">
                <a href={whatsappLink(`Bonjour ${SITE.name}, je souhaite passer commande.`)} target="_blank" rel="noreferrer">
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                  Contacter sur WhatsApp
                </a>
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
                Retour à la boutique
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => {
                  onClearCart();
                  onOpenChange(false);
                }}
              >
                Vider le panier
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={goNext} noValidate>
            <div className="space-y-4 border-b p-6 pr-14 sm:px-8">
              <DialogTitle className="font-display text-2xl font-semibold">Finaliser ma commande</DialogTitle>
              <DialogDescription className="sr-only">Formulaire de commande en trois étapes</DialogDescription>
              <div className="flex items-start gap-2 rounded-md bg-secondary px-3 py-2.5 text-sm text-secondary-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  <strong>Mode démonstration :</strong> la commande ne sera ni enregistrée, ni transmise, ni payée.
                </p>
              </div>
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
                    <span>{label}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-5 p-6 sm:px-8">
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
                  <Field id="checkout-commune" label="Commune" error={errors.commune}>
                    <select
                      id="checkout-commune"
                      value={form.commune}
                      onChange={(event) => update('commune', event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {DELIVERY.communes.map((commune) => (
                        <option key={commune} value={commune}>
                          {commune}
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
                        <dt className="text-muted-foreground">Livraison (indicatif)</dt>
                        <dd>{formatPrice(totals.delivery)}</dd>
                      </div>
                      <div className="flex justify-between border-t pt-2 text-base font-semibold">
                        <dt>Total</dt>
                        <dd className="text-primary">{formatPrice(totals.total)}</dd>
                      </div>
                    </dl>
                  </section>

                  <section aria-labelledby="recap-delivery" className="space-y-1 text-sm">
                    <h3 id="recap-delivery" className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Contact et livraison
                    </h3>
                    <p>
                      {form.firstName.trim()} {form.lastName.trim()} · {form.phone.trim()} · {form.email.trim()}
                    </p>
                    <p>
                      {form.address.trim()}, {form.commune}
                    </p>
                    {form.instructions.trim() && <p className="text-muted-foreground">{form.instructions.trim()}</p>}
                  </section>

                  <section aria-labelledby="recap-payment" className="space-y-1 text-sm">
                    <h3 id="recap-payment" className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Mode de paiement
                    </h3>
                    <p className="font-medium">{PAYMENT_METHOD.label}</p>
                    <p className="text-muted-foreground">Vous réglez à la réception de votre commande. Aucun paiement n’est traité en ligne.</p>
                  </section>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t p-6 sm:px-8">
              {step > 1 ? (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                  Retour
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="lg" className="h-11 px-6">
                {step === 3 ? 'Terminer la simulation' : 'Continuer'}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
