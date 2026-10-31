import { assertAdmin, type MutationResult } from '@/lib/admin/products';
import { AdminQueryError } from '@/lib/admin/queries';
import { COLLECTIONS, PROMO, SITE } from '@/lib/site';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Bannières personnalisables (hero, promo, inspirations), stockées dans `site_banners` (voir migration-bannieres.sql).
 * Lecture publique : en cas d'erreur ou de table absente, les valeurs par défaut de lib/site.ts sont utilisées.
 */

export interface Banners {
  hero: { image: string; badge: string };
  promo: {
    bg: string;
    fg: string;
    accent: string;
    image: string;
    eyebrow: string;
    title: string;
    highlight: string;
    subtitle: string;
    text: string;
    button: string;
    orbit: string;
  };
  collections: { image: string }[];
  /** Campagne de Noël : image facultative (vide = décor sans photo), lien interne ou https, dates facultatives (AAAA-MM-JJ). */
  christmas: {
    enabled: boolean;
    image: string;
    badge: string;
    title: string;
    subtitle: string;
    button: string;
    href: string;
    startsAt: string;
    endsAt: string;
  };
}

export const DEFAULT_BANNERS: Banners = {
  hero: { image: SITE.heroImage, badge: 'DEPUIS 2026' },
  promo: {
    bg: '#164e43',
    fg: '#ffffff',
    accent: '#e9ded0',
    image: PROMO.image,
    eyebrow: PROMO.eyebrow,
    title: PROMO.title,
    highlight: PROMO.highlight,
    subtitle: PROMO.subtitle,
    text: PROMO.text,
    button: PROMO.button,
    orbit: PROMO.orbit,
  },
  collections: COLLECTIONS.map((collection) => ({ image: collection.image })),
  // Photo Pexels (licence libre, voir CREDITS-IMAGES.md). Image vide = décor vectoriel intégré. Aucune réduction ni prix.
  christmas: {
    enabled: true,
    image: '/noel-2026.jpg',
    badge: 'COLLECTION SPÉCIALE NOËL',
    title: "LA MAGIE DE NOËL S'INVITE CHEZ VOUS",
    subtitle: "Offrez à votre intérieur l'élégance qu'il mérite.",
    button: 'DÉCOUVRIR LA COLLECTION',
    href: '#catalogue',
    startsAt: '',
    endsAt: '',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown, fallback: string, max = 200) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : fallback;
const color = (value: unknown, fallback: string) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
/** Seules les URL http(s) et les chemins du site sont acceptés (comme pour le catalogue). */
const image = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : fallback;
  } catch {
    return fallback;
  }
};

/** Lien interne (#ancre ou /chemin) ou https. */
const isUsableLink = (value: string) => {
  if (value.startsWith('#') && value.length > 1) return true;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
/** Date de calendrier STRICTE : 2026-02-30 ou 2026-04-31 ne « débordent » pas sur le mois suivant. */
const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export type ChristmasStatus = { active: boolean; label: string };

/** Explique l'état de la campagne à l'administrateur. L'interrupteur « désactivée » prévaut toujours sur les dates. */
export function christmasStatus(christmas: Banners['christmas'], today: string): ChristmasStatus {
  const fr = (iso: string) => iso.split('-').reverse().join('/');
  if (!christmas.enabled) return { active: false, label: 'Masquée : campagne désactivée (prévaut sur les dates).' };
  if (christmas.startsAt && christmas.endsAt && christmas.endsAt < christmas.startsAt) {
    return { active: false, label: 'Masquée : dates incohérentes (la fin précède le début).' };
  }
  if (christmas.startsAt && today < christmas.startsAt) return { active: false, label: `Masquée : démarre le ${fr(christmas.startsAt)}.` };
  if (christmas.endsAt && today > christmas.endsAt) return { active: false, label: `Masquée : période terminée (fin le ${fr(christmas.endsAt)}).` };
  const since = christmas.startsAt ? `du ${fr(christmas.startsAt)}` : 'sans date de début';
  const until = christmas.endsAt ? `au ${fr(christmas.endsAt)}` : 'sans date de fin';
  return { active: true, label: `Affichée : période active, bornes incluses (${since} ${until}).` };
}

/** La campagne s'affiche si elle est activée et si la date du jour (AAAA-MM-JJ) est dans la période éventuelle. */
export function isChristmasActive(christmas: Banners['christmas'], today: string): boolean {
  if (!christmas.enabled) return false;
  if (christmas.startsAt && today < christmas.startsAt) return false;
  if (christmas.endsAt && today > christmas.endsAt) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Validation avant enregistrement                                     */
/* ------------------------------------------------------------------ */

/** Erreurs par champ, clé = chemin du champ (`promo.title`, `hero.badge`, `collections.0`…). */
export type BannerErrors = Record<string, string>;

const REQUIRED_TEXT = 'Ce champ est obligatoire. « Valeurs par défaut » rétablit le texte d’origine.';
const TEXT_LIMITS: Record<string, number> = {
  'hero.badge': 30,
  'promo.eyebrow': 200,
  'promo.title': 200,
  'promo.highlight': 40,
  'promo.subtitle': 200,
  'promo.text': 300,
  'promo.button': 60,
  'promo.orbit': 30,
};
const COLOR_KEYS = ['promo.bg', 'promo.fg', 'promo.accent'] as const;

/** Copie dont les textes et adresses sont débarrassés des espaces de début et de fin (ce qui sera réellement enregistré). */
export function trimBanners(banners: Banners): Banners {
  return {
    hero: { image: banners.hero.image.trim(), badge: banners.hero.badge.trim() },
    promo: Object.fromEntries(Object.entries(banners.promo).map(([key, value]) => [key, value.trim()])) as Banners['promo'],
    collections: banners.collections.map((item) => ({ image: item.image.trim() })),
    christmas: {
      enabled: banners.christmas.enabled,
      image: banners.christmas.image.trim(),
      badge: banners.christmas.badge.trim(),
      title: banners.christmas.title.trim(),
      subtitle: banners.christmas.subtitle.trim(),
      button: banners.christmas.button.trim(),
      href: banners.christmas.href.trim(),
      startsAt: banners.christmas.startsAt.trim(),
      endsAt: banners.christmas.endsAt.trim(),
    },
  };
}

/**
 * Vérifie les valeurs SANS rien remplacer : une valeur vide ou invalide est signalée à l'administrateur,
 * jamais corrigée en silence. Une liste vide signifie que les valeurs peuvent être enregistrées telles quelles.
 */
export function validateBanners(input: Banners): BannerErrors {
  const banners = trimBanners(input);
  const errors: BannerErrors = {};
  const flat: Record<string, string> = {
    'hero.badge': banners.hero.badge,
    ...Object.fromEntries(Object.entries(banners.promo).map(([key, value]) => [`promo.${key}`, value])),
  };
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    const value = flat[key] ?? '';
    if (value === '') errors[key] = REQUIRED_TEXT;
    else if (value.length > max) errors[key] = `${max} caractères maximum (actuellement ${value.length}).`;
  }
  for (const key of COLOR_KEYS) {
    if (!/^#[0-9a-f]{6}$/i.test(flat[key] ?? '')) errors[key] = 'Couleur invalide : utilisez le format #rrggbb (par exemple #164e43).';
  }
  const images: [string, string][] = [
    ['hero.image', banners.hero.image],
    ['promo.image', banners.promo.image],
    ...banners.collections.map((item, index): [string, string] => [`collections.${index}`, item.image]),
  ];
  for (const [key, value] of images) {
    if (value === '') errors[key] = 'Une image est obligatoire : téléversez un fichier ou collez une adresse.';
    else if (image(value, '') === '') errors[key] = 'Adresse d’image invalide : utilisez une adresse https://… ou téléversez un fichier.';
  }
  // Campagne de Noël : textes obligatoires, image facultative, lien valide, dates cohérentes.
  const c = banners.christmas;
  const xmasText: [string, string, number][] = [
    ['christmas.badge', c.badge, 40],
    ['christmas.title', c.title, 120],
    ['christmas.subtitle', c.subtitle, 200],
    ['christmas.button', c.button, 40],
  ];
  for (const [key, value, max] of xmasText) {
    if (value === '') errors[key] = REQUIRED_TEXT;
    else if (value.length > max) errors[key] = `${max} caractères maximum (actuellement ${value.length}).`;
  }
  if (c.image !== '' && image(c.image, '') === '') errors['christmas.image'] = 'Adresse d’image invalide : utilisez une adresse https://… ou téléversez un fichier (ou laissez vide pour le décor intégré).';
  if (c.href === '') errors['christmas.href'] = 'Le lien du bouton est obligatoire.';
  else if (!isUsableLink(c.href)) errors['christmas.href'] = 'Lien invalide : utilisez #ancre, /chemin ou une adresse https://…';
  if (c.startsAt !== '' && !isDate(c.startsAt)) errors['christmas.startsAt'] = 'Date invalide (format AAAA-MM-JJ).';
  if (c.endsAt !== '' && !isDate(c.endsAt)) errors['christmas.endsAt'] = 'Date invalide (format AAAA-MM-JJ).';
  if (!errors['christmas.startsAt'] && !errors['christmas.endsAt'] && c.startsAt && c.endsAt && c.endsAt < c.startsAt) {
    errors['christmas.endsAt'] = 'La date de fin doit être postérieure ou égale à la date de début.';
  }
  return errors;
}

/** Fusionne des données brutes (base de données) avec les valeurs par défaut, en validant chaque champ. */
export function mergeBanners(raw: unknown): Banners {
  const d = DEFAULT_BANNERS;
  const source = isRecord(raw) ? raw : {};
  const hero = isRecord(source.hero) ? source.hero : {};
  const promo = isRecord(source.promo) ? source.promo : {};
  const collections = Array.isArray(source.collections) ? source.collections : [];
  const xmas = isRecord(source.christmas) ? source.christmas : {};
  return {
    hero: { image: image(hero.image, d.hero.image), badge: text(hero.badge, d.hero.badge, 30) },
    promo: {
      bg: color(promo.bg, d.promo.bg),
      fg: color(promo.fg, d.promo.fg),
      accent: color(promo.accent, d.promo.accent),
      image: image(promo.image, d.promo.image),
      eyebrow: text(promo.eyebrow, d.promo.eyebrow),
      title: text(promo.title, d.promo.title),
      highlight: text(promo.highlight, d.promo.highlight, 40),
      subtitle: text(promo.subtitle, d.promo.subtitle),
      text: text(promo.text, d.promo.text, 300),
      button: text(promo.button, d.promo.button, 60),
      orbit: text(promo.orbit, d.promo.orbit, 30),
    },
    collections: d.collections.map((item, index) => ({
      image: image(isRecord(collections[index]) ? (collections[index] as Record<string, unknown>).image : null, item.image),
    })),
    christmas: {
      enabled: typeof xmas.enabled === 'boolean' ? xmas.enabled : d.christmas.enabled,
      // Image facultative : absente = photo par défaut ; vide enregistrée volontairement = décor intégré ; valeur invalide = photo par défaut.
      image: typeof xmas.image === 'string' && xmas.image.trim() === '' ? '' : image(xmas.image, d.christmas.image),
      badge: text(xmas.badge, d.christmas.badge, 40),
      title: text(xmas.title, d.christmas.title, 120),
      subtitle: text(xmas.subtitle, d.christmas.subtitle),
      button: text(xmas.button, d.christmas.button, 40),
      href: typeof xmas.href === 'string' && isUsableLink(xmas.href.trim()) ? xmas.href.trim() : d.christmas.href,
      startsAt: typeof xmas.startsAt === 'string' && isDate(xmas.startsAt) ? xmas.startsAt : '',
      endsAt: typeof xmas.endsAt === 'string' && isDate(xmas.endsAt) ? xmas.endsAt : '',
    },
  };
}

/** Lecture publique : ne lève jamais d'erreur, retombe sur les valeurs par défaut. */
export async function fetchBanners(): Promise<Banners> {
  try {
    const { data, error } = await getSupabase().from('site_banners').select('data').limit(1);
    if (error || !Array.isArray(data) || !isRecord(data[0])) return DEFAULT_BANNERS;
    return mergeBanners(data[0].data);
  } catch {
    return DEFAULT_BANNERS;
  }
}

/** Lecture pour l'admin : indique si la table existe, pour afficher un message clair sinon. */
export async function fetchBannersForAdmin(): Promise<{ banners: Banners; tableMissing: boolean }> {
  const { data, error } = await getSupabase().from('site_banners').select('data').limit(1);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { banners: DEFAULT_BANNERS, tableMissing: true };
    // Code conservé pour distinguer permission refusée (42501), erreur SQL et erreur réseau (code vide).
    throw new AdminQueryError(error.code || null);
  }
  const row = Array.isArray(data) ? data[0] : null;
  return { banners: mergeBanners(isRecord(row) ? row.data : null), tableMissing: false };
}

/**
 * Enregistre les bannières puis renvoie les valeurs RÉELLEMENT stockées (relues dans la réponse de la base),
 * pour que le formulaire reflète exactement la base. Aucune valeur n'est remplacée en silence : les valeurs
 * vides ou invalides sont refusées avec leurs erreurs par champ (voir validateBanners).
 */
export async function saveBanners(banners: Banners): Promise<MutationResult<Banners>> {
  const clean = trimBanners(banners);
  if (Object.keys(validateBanners(clean)).length > 0) return { ok: false, message: 'Corrigez les champs signalés avant d’enregistrer.' };
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await getSupabase().from('site_banners').upsert({ id: true, data: clean }).select('id, data');
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return { ok: false, message: 'La table des bannières n’existe pas encore : appliquez migration-bannieres.sql dans Supabase.' };
      }
      // Les saisies restent affichées dans tous les cas d'échec.
      if (!error.code) return { ok: false, message: 'Connexion impossible : rien n’a été enregistré. Vos saisies sont conservées, réessayez.' };
      if (error.code === '42501') return { ok: false, message: 'Enregistrement refusé : votre compte n’a pas le droit de modifier les bannières. Vos saisies sont conservées.' };
      return { ok: false, message: `Enregistrement impossible (code ${error.code}). Vos saisies sont conservées.` };
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!isRecord(row)) return { ok: false, message: 'Aucune modification enregistrée : droit refusé. Vos saisies sont conservées.' };
    return { ok: true, data: mergeBanners(row.data) };
  } catch {
    return { ok: false, message: 'Connexion impossible pour le moment : rien n’a été enregistré. Vos saisies sont conservées.' };
  }
}
