'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, MessageCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChoiceGroup, Field, describedBy } from '@/components/custom/form-fields';
import { ImageDropzone, buildPicked, useRevokePreviews, type PickedImage } from '@/components/custom/image-dropzone';
import { usePersistentState } from '@/hooks/use-persistent-state';
import {
  BUDGET_RANGES,
  CONTACT_METHODS,
  DEADLINE_KINDS,
  DRAFT_KEY,
  EMPTY_FORM,
  INSPIRATION_SOURCES,
  LAST_STEP,
  PROJECT_TYPES,
  STEPS,
  confirmationWhatsAppMessage,
  firstInvalidStep,
  labelOf,
  newRequestKey,
  sanitizeDraft,
  submitCustomRequest,
  validateStep,
  type CustomRequestForm,
  type Draft,
  type FormErrors,
  type ImageKind,
} from '@/lib/custom-requests';
import { whatsappLink } from '@/lib/site';

const INITIAL_DRAFT: Draft = { form: EMPTY_FORM, step: 0 };

function Progress({ step }: { step: number }) {
  return (
    <nav aria-label="Progression du formulaire">
      <p className="mb-3 text-sm font-semibold text-muted-foreground sm:hidden">
        Étape {step + 1} sur {STEPS.length} · <span className="text-foreground">{STEPS[step]}</span>
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2" aria-current={current ? 'step' : undefined}>
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done ? 'bg-primary text-primary-foreground' : current ? 'border-2 border-primary text-primary' : 'border border-input text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
                <span className="sr-only">
                  {label}
                  {done ? ' (terminée)' : current ? ' (en cours)' : ''}
                </span>
              </span>
              <span className={`hidden text-xs font-semibold lg:block ${current ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
              {index < STEPS.length - 1 && <span aria-hidden className={`h-px flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function Success({ reference, name, onNew }: { reference: string; name: string; onNew: () => void }) {
  return (
    <div role="status" className="space-y-5 rounded-[22px] border bg-card p-6 text-center shadow-sm sm:p-10">
      <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
      <h2 className="text-2xl sm:text-3xl">Merci pour votre confiance</h2>
      <p className="mx-auto max-w-xl text-muted-foreground">
        Votre projet a bien été transmis à notre équipe Meritt Home. Nous reviendrons vers vous pour discuter de sa faisabilité et vous proposer une solution personnalisée.
      </p>
      <p className="inline-block rounded-full bg-accent px-4 py-1.5 text-sm font-bold text-accent-foreground">Référence : {reference}</p>
      <p className="mx-auto max-w-xl text-xs text-muted-foreground">
        L’envoi d’une demande ne constitue ni une commande ferme ni un engagement de prix.
      </p>
      <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
        <Button asChild size="lg" className="bg-[#1d9b64] text-white hover:bg-[#188556]">
          <a href={whatsappLink(confirmationWhatsAppMessage(reference, name))} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-5 w-5" aria-hidden />
            Nous écrire sur WhatsApp
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Retour à la boutique</Link>
        </Button>
      </div>
      <button type="button" onClick={onNew} className="text-sm font-medium text-ring underline-offset-4 hover:underline">
        Envoyer une autre demande
      </button>
    </div>
  );
}

export function CustomRequestFormSection() {
  const [draft, setDraft, draftReady] = usePersistentState<Draft>(DRAFT_KEY, INITIAL_DRAFT, sanitizeDraft);
  const { form, step } = draft;
  const [images, setImages] = useState<PickedImage[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; name: string } | null>(null);
  // Une clé par demande : un nouvel essai après une erreur réseau ne peut jamais créer de doublon.
  const requestKey = useRef<string | null>(null);
  const submitLock = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const draftChecked = useRef(false);

  useRevokePreviews(images);

  // Brouillon retrouvé : on prévient le client (une seule fois), sans jamais restaurer les images.
  useEffect(() => {
    if (!draftReady || draftChecked.current) return;
    draftChecked.current = true;
    if (step > 0 || form.name !== '' || form.phone !== '' || form.description !== '') setRestoredNotice(true);
  }, [draftReady, step, form]);

  const update = useCallback(
    <K extends keyof CustomRequestForm>(key: K, value: CustomRequestForm[K]) => {
      setDraft((current) => ({ ...current, form: { ...current.form, [key]: value } }));
      setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
    },
    [setDraft]
  );

  const goTo = (next: number) => {
    setDraft((current) => ({ ...current, step: next }));
    setErrors({});
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };

  const next = () => {
    const found = validateStep(step, form, images.length);
    setErrors(found);
    if (Object.keys(found).length === 0) goTo(step + 1);
  };

  const addImages = (files: File[], kind: ImageKind): string[] => {
    const { picked, messages } = buildPicked(files, kind, images);
    if (picked.length > 0) setImages((current) => [...current, ...picked]);
    return messages;
  };

  const removeImage = (id: string) => {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  };

  const reset = () => {
    for (const image of images) URL.revokeObjectURL(image.previewUrl);
    setImages([]);
    setDraft(INITIAL_DRAFT);
    setErrors({});
    setSubmitError(null);
    setDone(null);
    requestKey.current = null;
  };

  const submit = async () => {
    if (submitLock.current) return; // protection contre le double clic avant le rendu de l'état « envoi en cours »
    const invalid = firstInvalidStep(form);
    if (invalid !== -1) {
      goTo(invalid);
      setErrors(validateStep(invalid, form, images.length));
      return;
    }
    const consent = validateStep(LAST_STEP, form);
    if (Object.keys(consent).length > 0) {
      setErrors(consent);
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setSubmitError(null);
    requestKey.current ??= newRequestKey();
    const result = await submitCustomRequest(
      requestKey.current,
      form,
      images.map((image) => ({ file: image.file, kind: image.kind }))
    );
    submitLock.current = false;
    setSubmitting(false);
    if (result.ok) {
      const name = form.name;
      for (const image of images) URL.revokeObjectURL(image.previewUrl);
      setImages([]);
      setDraft(INITIAL_DRAFT);
      requestKey.current = null;
      setRestoredNotice(false);
      setDone({ reference: result.reference, name });
      requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
      return;
    }
    setSubmitError(result.message);
    if (result.step !== undefined) goTo(result.step);
  };

  if (done) {
    return (
      <div ref={topRef} className="scroll-mt-28">
        <Success reference={done.reference} name={done.name} onNew={reset} />
      </div>
    );
  }

  const field = <K extends keyof CustomRequestForm>(key: K) => ({
    id: `f-${key}`,
    value: form[key] as string,
    onChange: (event: { target: { value: string } }) => update(key, event.target.value as CustomRequestForm[K]),
    'aria-invalid': errors[key] ? (true as const) : undefined,
    'aria-describedby': describedBy(`f-${key}`, undefined, errors[key]),
  });

  return (
    <div ref={topRef} className="scroll-mt-28 space-y-6">
      <Progress step={step} />

      {restoredNotice && (
        <p className="rounded-[13px] bg-accent px-4 py-2.5 text-sm text-accent-foreground">
          Votre demande en cours a été retrouvée. Les images ne sont pas conservées : vous pourrez les rajouter.{' '}
          <button
            type="button"
            onClick={() => {
              setRestoredNotice(false);
              reset();
            }}
            className="font-semibold underline underline-offset-4"
          >
            Recommencer à zéro
          </button>
        </p>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step === LAST_STEP) void submit();
          else next();
        }}
        className="space-y-6 rounded-[22px] border bg-card p-5 shadow-sm sm:p-8"
      >
        <h2 className="text-xl sm:text-2xl">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="f-name" label="Nom et prénom" required error={errors.name} className="sm:col-span-2">
              <Input {...field('name')} autoComplete="name" maxLength={120} />
            </Field>
            <Field id="f-phone" label="Téléphone / WhatsApp" required error={errors.phone} hint="Avec l’indicatif si possible, par exemple +225 07 00 00 00 00.">
              <Input {...field('phone')} aria-describedby={describedBy('f-phone', 'hint', errors.phone)} type="tel" inputMode="tel" autoComplete="tel" maxLength={30} />
            </Field>
            <Field id="f-email" label="Adresse e-mail" error={errors.email}>
              <Input {...field('email')} type="email" inputMode="email" autoComplete="email" maxLength={160} />
            </Field>
            <Field id="f-commune" label="Commune / quartier" error={errors.commune} className="sm:col-span-2">
              <Input {...field('commune')} autoComplete="address-level2" maxLength={80} />
            </Field>
            <div className="sm:col-span-2">
              <ChoiceGroup
                name="contact"
                legend="Moyen de contact préféré"
                options={CONTACT_METHODS}
                value={form.contact}
                onChange={(value) => update('contact', value)}
                error={errors.contact}
                columns="grid-cols-3"
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <ChoiceGroup
            name="projectType"
            legend="Quelle est la nature de votre projet ?"
            required
            options={PROJECT_TYPES}
            value={form.projectType}
            onChange={(value) => update('projectType', value)}
            error={errors.projectType}
            columns="sm:grid-cols-2 lg:grid-cols-3"
          />
        )}

        {step === 2 && (
          <div className="space-y-6">
            <ChoiceGroup
              name="source"
              legend="Où avez-vous trouvé votre inspiration ?"
              options={INSPIRATION_SOURCES}
              value={form.source}
              onChange={(value) => update('source', value)}
              error={errors.source}
              columns="grid-cols-2 sm:grid-cols-3"
            />
            <Field id="f-referenceUrl" label="Lien de référence" error={errors.referenceUrl} hint="Lien https:// du Pinterest, de la publication Instagram, TikTok, etc.">
              <Input
                {...field('referenceUrl')}
                aria-describedby={describedBy('f-referenceUrl', 'hint', errors.referenceUrl)}
                type="url"
                inputMode="url"
                placeholder="https://www.pinterest.com/pin/…"
                maxLength={500}
              />
            </Field>
            <ImageDropzone
              kind="inspiration"
              title="Images d’inspiration"
              description="Captures d’écran, photos de meubles ou d’ambiances qui vous plaisent."
              images={images}
              onAdd={addImages}
              onRemove={removeImage}
            />
            <ImageDropzone
              kind="space"
              title="Photos de votre espace"
              description="L’endroit où la création sera installée : cela nous aide à proposer des dimensions justes."
              images={images}
              onAdd={addImages}
              onRemove={removeImage}
            />
            {errors.images && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {errors.images}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="f-description" label="Description du projet" required error={errors.description} className="sm:col-span-3" hint="Ce que vous imaginez, l’usage, le style, les éléments importants.">
              <Textarea {...field('description')} aria-describedby={describedBy('f-description', 'hint', errors.description)} rows={5} maxLength={4000} />
            </Field>
            <p className="text-sm text-muted-foreground sm:col-span-3">
              Dimensions approximatives en centimètres. Laissez vide si vous ne les connaissez pas : nous les définirons ensemble.
            </p>
            <Field id="f-width" label="Largeur (cm)" error={errors.width}>
              <Input {...field('width')} inputMode="numeric" maxLength={5} />
            </Field>
            <Field id="f-height" label="Hauteur (cm)" error={errors.height}>
              <Input {...field('height')} inputMode="numeric" maxLength={5} />
            </Field>
            <Field id="f-depth" label="Profondeur (cm)" error={errors.depth}>
              <Input {...field('depth')} inputMode="numeric" maxLength={5} />
            </Field>
            <Field id="f-materials" label="Matériaux souhaités" error={errors.materials} className="sm:col-span-3">
              <Input {...field('materials')} placeholder="Bois massif, rotin, marbre…" maxLength={300} />
            </Field>
            <Field id="f-colors" label="Couleurs souhaitées" error={errors.colors} className="sm:col-span-3 lg:col-span-1">
              <Input {...field('colors')} maxLength={300} />
            </Field>
            <Field id="f-finishes" label="Finitions" error={errors.finishes} className="sm:col-span-3 lg:col-span-1">
              <Input {...field('finishes')} placeholder="Mat, laqué, vernis…" maxLength={300} />
            </Field>
            <Field id="f-quantity" label="Quantité" required error={errors.quantity} className="sm:col-span-3 lg:col-span-1">
              <Input {...field('quantity')} inputMode="numeric" maxLength={3} />
            </Field>
            <Field id="f-constraints" label="Contraintes particulières" error={errors.constraints} className="sm:col-span-3" hint="Accès, étage, humidité, enfants, animaux…">
              <Textarea {...field('constraints')} aria-describedby={describedBy('f-constraints', 'hint', errors.constraints)} rows={3} maxLength={1000} />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <ChoiceGroup name="budget" legend="Budget estimatif" required options={BUDGET_RANGES} value={form.budget} onChange={(value) => update('budget', value)} error={errors.budget} />
            <ChoiceGroup
              name="deadlineKind"
              legend="Délai souhaité"
              required
              options={DEADLINE_KINDS}
              value={form.deadlineKind}
              onChange={(value) => update('deadlineKind', value)}
              error={errors.deadlineKind}
            />
            {form.deadlineKind === 'custom_date' && (
              <Field id="f-deadlineDate" label="Date souhaitée" required error={errors.deadlineDate} className="max-w-xs">
                <Input {...field('deadlineDate')} type="date" min={new Date().toISOString().slice(0, 10)} />
              </Field>
            )}
          </div>
        )}

        {step === LAST_STEP && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">Vérifiez votre demande avant de l’envoyer. Vous pouvez revenir en arrière pour corriger.</p>
            <dl className="divide-y rounded-[13px] border px-4">
              <SummaryRow label="Nom" value={form.name.trim()} />
              <SummaryRow label="Téléphone / WhatsApp" value={form.phone.trim()} />
              <SummaryRow label="E-mail" value={form.email.trim()} />
              <SummaryRow label="Commune / quartier" value={form.commune.trim()} />
              <SummaryRow label="Contact préféré" value={labelOf(CONTACT_METHODS, form.contact)} />
              <SummaryRow label="Nature du projet" value={labelOf(PROJECT_TYPES, form.projectType)} />
              <SummaryRow label="Source d’inspiration" value={form.source ? labelOf(INSPIRATION_SOURCES, form.source) : null} />
              <SummaryRow label="Lien de référence" value={form.referenceUrl.trim()} />
              <SummaryRow label="Images jointes" value={images.length > 0 ? `${images.length} image${images.length > 1 ? 's' : ''}` : 'Aucune'} />
              <SummaryRow label="Description" value={form.description.trim()} />
              <SummaryRow
                label="Dimensions (cm)"
                value={[form.width && `L ${form.width}`, form.height && `H ${form.height}`, form.depth && `P ${form.depth}`].filter(Boolean).join(' × ') || null}
              />
              <SummaryRow label="Matériaux" value={form.materials.trim()} />
              <SummaryRow label="Couleurs" value={form.colors.trim()} />
              <SummaryRow label="Finitions" value={form.finishes.trim()} />
              <SummaryRow label="Quantité" value={form.quantity.trim()} />
              <SummaryRow label="Contraintes" value={form.constraints.trim()} />
              <SummaryRow label="Budget" value={labelOf(BUDGET_RANGES, form.budget)} />
              <SummaryRow
                label="Délai"
                value={form.deadlineKind === 'custom_date' ? `Avant le ${form.deadlineDate.split('-').reverse().join('/')}` : labelOf(DEADLINE_KINDS, form.deadlineKind)}
              />
            </dl>

            {/* Champ piège (honeypot) : invisible pour les clients, rempli par les robots. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="f-website">Ne pas remplir</label>
              <input id="f-website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update('website', event.target.value)} />
            </div>

            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-[13px] border border-input p-4 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={form.consent}
                  onChange={(event) => update('consent', event.target.checked)}
                  aria-invalid={errors.consent ? true : undefined}
                  aria-describedby={errors.consent ? 'f-consent-error' : undefined}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                />
                <span>
                  J’accepte que Meritt Home utilise les informations et les images transmises pour étudier ma demande et me recontacter. <span aria-hidden className="text-destructive">*</span>
                </span>
              </label>
              {errors.consent && (
                <p id="f-consent-error" role="alert" className="text-sm font-medium text-destructive">
                  {errors.consent}
                </p>
              )}
              <p className="text-xs text-muted-foreground">L’envoi d’une demande ne constitue ni une commande ferme ni un engagement de prix.</p>
            </div>

            {submitError && (
              <p role="alert" className="rounded-[13px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
                {submitError}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => goTo(step - 1)} disabled={submitting} className="justify-center">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Retour
            </Button>
          ) : (
            <span />
          )}
          {step < LAST_STEP ? (
            <Button type="submit" size="lg" className="justify-center">
              Continuer
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={submitting} className="justify-center font-bold tracking-wide">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Envoi en cours…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" aria-hidden />
                  ENVOYER MA DEMANDE
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
