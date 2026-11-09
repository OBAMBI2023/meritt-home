import { z } from 'zod';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Module « Création sur mesure » côté boutique : options, validation par étape, brouillon local et envoi.
 *
 * L'envoi passe par la fonction SQL `create_custom_request` (voir migration-sur-mesure.sql), qui REVALIDE tout :
 * la validation faite ici ne sert qu'à guider le client. Les images sont envoyées dans le bucket privé
 * `meritt-custom-requests` sous « <clé de la demande>/<uuid>.<ext> » avant l'appel de la fonction.
 */

export const CUSTOM_REQUEST_BUCKET = 'meritt-custom-requests';
export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
type ImageType = keyof typeof IMAGE_TYPES;
const EXTENSION_TYPES: Record<string, ImageType> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export interface Option {
  value: string;
  label: string;
}

export const PROJECT_TYPES: Option[] = [
  { value: 'living', label: 'Salon et mobilier' },
  { value: 'bedroom', label: 'Chambre et literie' },
  { value: 'dressing', label: 'Dressing et rangement' },
  { value: 'kitchen', label: 'Cuisine et aménagement' },
  { value: 'tv_unit', label: 'Meuble TV et meuble décoratif' },
  { value: 'dining', label: 'Table et salle à manger' },
  { value: 'decoration', label: 'Décoration intérieure' },
  { value: 'professional', label: 'Mobilier professionnel' },
  { value: 'other', label: 'Autre projet' },
];

export const INSPIRATION_SOURCES: Option[] = [
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'catalogue', label: 'Catalogue' },
  { value: 'other', label: 'Autre' },
];

export const CONTACT_METHODS: Option[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Téléphone' },
  { value: 'email', label: 'E-mail' },
];

export const BUDGET_RANGES: Option[] = [
  { value: 'lt_100k', label: 'Moins de 100 000 FCFA' },
  { value: '100k_250k', label: '100 000 à 250 000 FCFA' },
  { value: '250k_500k', label: '250 000 à 500 000 FCFA' },
  { value: '500k_1m', label: '500 000 à 1 000 000 FCFA' },
  { value: 'gt_1m', label: 'Plus de 1 000 000 FCFA' },
  { value: 'to_define', label: 'À définir avec Meritt Home' },
];

export const DEADLINE_KINDS: Option[] = [
  { value: 'asap', label: 'Dès que possible' },
  { value: 'month', label: 'Dans le mois' },
  { value: 'two_three_months', label: 'Dans les deux à trois mois' },
  { value: 'custom_date', label: 'Date personnalisée' },
  { value: 'none', label: 'Pas de contrainte particulière' },
];

export const labelOf = (options: Option[], value: string): string => options.find((option) => option.value === value)?.label ?? '—';

/* ------------------------------------------------------------------ */
/* Formulaire                                                          */
/* ------------------------------------------------------------------ */

export interface CustomRequestForm {
  name: string;
  phone: string;
  email: string;
  commune: string;
  contact: string;
  projectType: string;
  source: string;
  referenceUrl: string;
  description: string;
  width: string;
  height: string;
  depth: string;
  materials: string;
  colors: string;
  finishes: string;
  quantity: string;
  constraints: string;
  budget: string;
  deadlineKind: string;
  deadlineDate: string;
  consent: boolean;
  /** Champ piège (honeypot) : invisible pour les clients, rempli par les robots. */
  website: string;
}

export const EMPTY_FORM: CustomRequestForm = {
  name: '',
  phone: '',
  email: '',
  commune: '',
  contact: 'whatsapp',
  projectType: '',
  source: '',
  referenceUrl: '',
  description: '',
  width: '',
  height: '',
  depth: '',
  materials: '',
  colors: '',
  finishes: '',
  quantity: '1',
  constraints: '',
  budget: 'to_define',
  deadlineKind: 'none',
  deadlineDate: '',
  consent: false,
  website: '',
};

export const STEPS = ['Vos coordonnées', 'Votre projet', 'Inspirations', 'Détails techniques', 'Budget et délai', 'Validation'] as const;
export const LAST_STEP = STEPS.length - 1;

export type FormErrors = Partial<Record<keyof CustomRequestForm | 'images', string>>;

const oneOf = (options: Option[]) => (value: string) => options.some((option) => option.value === value);
const PINTEREST_HOST = /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/;

/** Retourne le message d'erreur d'une adresse de référence, ou null si elle est valide (vide autorisé). */
export function referenceUrlError(value: string, source: string): string | null {
  const url = value.trim();
  if (url === '') return null;
  if (/\s/.test(url) || url.length > 500) return 'Le lien est invalide ou trop long (500 caractères maximum).';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Le lien n’est pas une adresse valide. Exemple : https://www.pinterest.com/pin/123456/';
  }
  if (parsed.protocol !== 'https:') return 'Le lien doit commencer par https:// (les liens http ne sont pas acceptés).';
  if (source === 'pinterest' && !PINTEREST_HOST.test(parsed.hostname.toLowerCase())) {
    return 'Ce lien ne semble pas venir de Pinterest (pinterest.com ou pin.it). Choisissez une autre source ou corrigez le lien.';
  }
  return null;
}

const optionalDimension = z
  .string()
  .trim()
  .refine((value) => value === '' || (/^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 10000), 'Indiquez un nombre entier en centimètres (1 à 10 000), ou laissez vide.');

const stepSchemas = [
  z.object({
    name: z.string().trim().min(2, 'Indiquez votre nom et prénom.').max(120, 'Le nom est trop long (120 caractères maximum).'),
    phone: z
      .string()
      .trim()
      .max(30, 'Le numéro est trop long.')
      .refine((value) => /^\d{8,15}$/.test(value.replace(/\D/g, '')), 'Indiquez un numéro valide (8 à 15 chiffres), par exemple +225 07 00 00 00 00.'),
    email: z
      .string()
      .trim()
      .max(160, 'L’adresse e-mail est trop longue.')
      .refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'Cette adresse e-mail ne semble pas valide.'),
    commune: z.string().trim().max(80, 'La commune est trop longue (80 caractères maximum).'),
    contact: z.string().refine(oneOf(CONTACT_METHODS), 'Choisissez un moyen de contact.'),
  }),
  z.object({
    projectType: z.string().refine(oneOf(PROJECT_TYPES), 'Choisissez la nature de votre projet.'),
  }),
  z.object({
    source: z.string().refine((value) => value === '' || oneOf(INSPIRATION_SOURCES)(value), 'Source d’inspiration invalide.'),
  }),
  z.object({
    description: z.string().trim().min(10, 'Décrivez votre projet en quelques mots (10 caractères minimum).').max(4000, 'La description est trop longue (4 000 caractères maximum).'),
    width: optionalDimension,
    height: optionalDimension,
    depth: optionalDimension,
    materials: z.string().trim().max(300, '300 caractères maximum.'),
    colors: z.string().trim().max(300, '300 caractères maximum.'),
    finishes: z.string().trim().max(300, '300 caractères maximum.'),
    quantity: z.string().trim().refine((value) => /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100, 'La quantité doit être comprise entre 1 et 100.'),
    constraints: z.string().trim().max(1000, 'Les contraintes sont trop longues (1 000 caractères maximum).'),
  }),
  z.object({
    budget: z.string().refine(oneOf(BUDGET_RANGES), 'Choisissez une tranche de budget.'),
    deadlineKind: z.string().refine(oneOf(DEADLINE_KINDS), 'Choisissez un délai.'),
  }),
  z.object({
    consent: z.literal(true, { errorMap: () => ({ message: 'Vous devez accepter pour envoyer votre demande.' }) }),
  }),
];

/** Valide une étape ; retourne les erreurs par champ (objet vide = étape valide). */
export function validateStep(step: number, form: CustomRequestForm, imageCount = 0): FormErrors {
  const errors: FormErrors = {};
  const schema = stepSchemas[step];
  if (schema) {
    const result = schema.safeParse(form);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof CustomRequestForm;
        if (!errors[key]) errors[key] = issue.message;
      }
    }
  }
  if (step === 0 && form.contact === 'email' && form.email.trim() === '') errors.email = 'Indiquez votre adresse e-mail pour être contacté par e-mail.';
  if (step === 2) {
    const urlError = referenceUrlError(form.referenceUrl, form.source);
    if (urlError) errors.referenceUrl = urlError;
  }
  if (step === 4 && form.deadlineKind === 'custom_date') {
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadlineDate)) errors.deadlineDate = 'Choisissez une date.';
    else if (form.deadlineDate < today) errors.deadlineDate = 'La date doit être aujourd’hui ou plus tard.';
  }
  if (imageCount > MAX_IMAGES) errors.images = `Vous pouvez joindre ${MAX_IMAGES} images au maximum.`;
  return errors;
}

/** Premier écran contenant une erreur (pour renvoyer le client là où il doit corriger), ou -1. */
export function firstInvalidStep(form: CustomRequestForm): number {
  for (let step = 0; step < LAST_STEP; step += 1) {
    if (Object.keys(validateStep(step, form)).length > 0) return step;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

export type ImageKind = 'inspiration' | 'space';

export interface ImageCheck {
  ok: boolean;
  type?: ImageType;
  message?: string;
}

export function checkImageFile(file: File): ImageCheck {
  const byMime = file.type in IMAGE_TYPES ? (file.type as ImageType) : undefined;
  const byExtension = EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  const type = byMime ?? (file.type === '' ? byExtension : undefined);
  if (!type) return { ok: false, message: `« ${file.name} » : format refusé. Formats acceptés : JPG, JPEG, PNG et WEBP.` };
  if (file.size === 0) return { ok: false, message: `« ${file.name} » est vide.` };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: `« ${file.name} » dépasse 5 Mo.` };
  return { ok: true, type };
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/* ------------------------------------------------------------------ */
/* Brouillon local (jamais d'images : elles ne peuvent pas être conservées)  */
/* ------------------------------------------------------------------ */

export const DRAFT_KEY = 'meritt-custom-request-draft-v1';

export interface Draft {
  form: CustomRequestForm;
  step: number;
}

export function sanitizeDraft(raw: unknown): Draft {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const stored = typeof record.form === 'object' && record.form !== null ? (record.form as Record<string, unknown>) : {};
  const form: CustomRequestForm = { ...EMPTY_FORM };
  for (const key of Object.keys(EMPTY_FORM) as (keyof CustomRequestForm)[]) {
    const value = stored[key];
    if (key === 'consent') form.consent = false; // le consentement doit toujours être redonné
    else if (key === 'website') form.website = '';
    else if (typeof value === 'string') (form[key] as string) = value.slice(0, 4000);
  }
  const step = typeof record.step === 'number' && Number.isInteger(record.step) ? Math.min(Math.max(record.step, 0), LAST_STEP - 1) : 0;
  return { form, step };
}

/* ------------------------------------------------------------------ */
/* Envoi                                                               */
/* ------------------------------------------------------------------ */

export interface SubmitImage {
  file: File;
  kind: ImageKind;
}

export type SubmitResult =
  | { ok: true; reference: string }
  | { ok: false; code: string; message: string; step?: number };

const MESSAGES: Record<string, string> = {
  REQUEST_REJECTED: 'Votre demande n’a pas pu être acceptée. Rechargez la page puis réessayez.',
  CONSENT_REQUIRED: 'Vous devez accepter l’utilisation de vos informations pour envoyer la demande.',
  INVALID_CUSTOMER: 'Vérifiez votre nom et votre commune.',
  INVALID_PHONE: 'Le numéro de téléphone est invalide.',
  INVALID_EMAIL: 'L’adresse e-mail est invalide.',
  INVALID_PROJECT: 'Vérifiez la description de votre projet.',
  INVALID_URL: 'Le lien de référence doit commencer par https://.',
  INVALID_DIMENSIONS: 'Vérifiez les dimensions et la quantité.',
  INVALID_DEADLINE: 'Vérifiez le délai souhaité.',
  INVALID_IMAGES: 'Une des images n’a pas pu être validée. Retirez-la puis réessayez.',
  RATE_LIMITED: 'Vous avez déjà envoyé plusieurs demandes récemment. Patientez un peu ou contactez-nous sur WhatsApp.',
};
const GENERIC = 'Votre demande n’a pas pu être envoyée. Vérifiez votre connexion puis réessayez : aucun doublon ne sera créé. Si le problème persiste, contactez-nous sur WhatsApp.';

const STEP_OF: Record<string, number> = {
  INVALID_CUSTOMER: 0,
  INVALID_PHONE: 0,
  INVALID_EMAIL: 0,
  INVALID_PROJECT: 3,
  INVALID_URL: 2,
  INVALID_IMAGES: 2,
  INVALID_DIMENSIONS: 3,
  INVALID_DEADLINE: 4,
};

function uniqueId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Clé de la demande : générée une fois par formulaire, réutilisée à chaque nouvel essai (idempotence). */
export const newRequestKey = uniqueId;

const nullIfEmpty = (value: string) => (value.trim() === '' ? null : value.trim());
const intOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

export async function submitCustomRequest(key: string, form: CustomRequestForm, images: SubmitImage[]): Promise<SubmitResult> {
  try {
    const supabase = getSupabase();
    const storage = supabase.storage.from(CUSTOM_REQUEST_BUCKET);

    const uploaded: { path: string; kind: ImageKind; mime: ImageType }[] = [];
    for (const image of images) {
      const check = checkImageFile(image.file);
      if (!check.ok || !check.type) return { ok: false, code: 'INVALID_IMAGES', message: check.message ?? MESSAGES.INVALID_IMAGES, step: 2 };
      const path = `${key}/${uniqueId()}.${IMAGE_TYPES[check.type]}`;
      const { error } = await storage.upload(path, image.file, { contentType: check.type, cacheControl: '3600', upsert: false });
      if (error) return { ok: false, code: 'UPLOAD_FAILED', message: 'L’envoi d’une image a échoué. Vérifiez votre connexion puis réessayez.', step: 2 };
      uploaded.push({ path, kind: image.kind, mime: check.type });
    }

    const { data, error } = await supabase.rpc('create_custom_request', {
      p_idempotency_key: key,
      p_customer_name: form.name.trim(),
      p_customer_phone: form.phone.trim(),
      p_customer_email: nullIfEmpty(form.email),
      p_commune: nullIfEmpty(form.commune),
      p_preferred_contact: form.contact,
      p_project_type: form.projectType,
      p_inspiration_source: nullIfEmpty(form.source),
      p_reference_url: nullIfEmpty(form.referenceUrl),
      p_description: form.description.trim(),
      p_width_cm: intOrNull(form.width),
      p_height_cm: intOrNull(form.height),
      p_depth_cm: intOrNull(form.depth),
      p_materials: nullIfEmpty(form.materials),
      p_colors: nullIfEmpty(form.colors),
      p_finishes: nullIfEmpty(form.finishes),
      p_quantity: Number(form.quantity || '1'),
      p_constraints: nullIfEmpty(form.constraints),
      p_budget_range: form.budget,
      p_deadline_kind: form.deadlineKind,
      p_deadline_date: form.deadlineKind === 'custom_date' ? form.deadlineDate : null,
      p_consent: form.consent,
      p_images: uploaded.map((image) => ({ path: image.path, kind: image.kind })),
      p_website: form.website,
    });
    if (error) {
      const code = typeof error.message === 'string' && error.message in MESSAGES ? error.message : 'UNKNOWN';
      return { ok: false, code, message: MESSAGES[code] ?? GENERIC, step: STEP_OF[code] };
    }
    const reference = typeof data === 'object' && data !== null && typeof (data as { reference?: unknown }).reference === 'string' ? (data as { reference: string }).reference : null;
    // Succès uniquement si la base a répondu avec une référence : aucune confirmation n'est inventée.
    if (!reference) return { ok: false, code: 'BAD_RESPONSE', message: GENERIC };
    return { ok: true, reference };
  } catch {
    return { ok: false, code: 'NETWORK', message: GENERIC };
  }
}

/** Message WhatsApp prérempli après l'envoi (la référence permet à l'équipe de retrouver la demande). */
export function confirmationWhatsAppMessage(reference: string, name: string): string {
  return `Bonjour Meritt Home, je suis ${name.trim()}. Je viens d'envoyer ma demande de création sur mesure (référence ${reference}). Je reste disponible pour échanger sur mon projet.`;
}
