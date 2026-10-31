import { z } from 'zod';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Écritures sur `public.products` avec la session de l'administrateur connecté.
 * Aucune clé secrète n'est utilisée : c'est la RLS (fonction `is_admin()`) qui autorise ou refuse chaque écriture.
 * Le stock n'est pas géré ici (table `product_inventory`, module Stocks).
 */

export const productFormSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.').max(120, 'Le nom est trop long (120 caractères maximum).'),
  description: z.string().trim().max(2000, 'La description est trop longue (2 000 caractères maximum).'),
  price: z
    .string()
    .trim()
    .min(1, 'Le prix est obligatoire.')
    .regex(/^\d+$/, 'Le prix doit être un nombre entier de FCFA, sans décimales.')
    .transform(Number)
    .refine((value) => value > 0 && value <= 100_000_000, 'Le prix doit être compris entre 1 et 100 000 000 FCFA.'),
  categoryId: z.string().min(1, 'Choisissez une catégorie : elle est obligatoire.'),
  imageUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || /^https:\/\/\S+$/.test(value), 'L’adresse de l’image doit commencer par https://.'),
});

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormValues = z.output<typeof productFormSchema>;

export type MutationResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Nom de la colonne d'une violation NOT NULL : `null value in column "x" of relation "y" violates not-null constraint`. */
function missingColumn(message: string | undefined): string | null {
  return message?.match(/null value in column "([^"]+)"/)?.[1] ?? null;
}

export function describe(error: { code?: string; message?: string } | null): string {
  switch (error?.code) {
    case '42501':
      return 'Permission refusée par la base : votre compte ne peut pas modifier les produits.';
    case '23505':
      return 'Un produit avec cet identifiant existe déjà.';
    case '23502': {
      const column = missingColumn(error.message);
      return column ? `La colonne obligatoire « ${column} » est manquante dans le produit.` : 'Un champ obligatoire de la base est manquant.';
    }
    case '23514':
      return 'Une valeur ne respecte pas les règles de la base.';
    case '23503':
      return 'La catégorie choisie n’existe pas.';
    default:
      return `L’enregistrement a échoué${error?.code ? ` (code ${error.code})` : ''}. Réessayez.`;
  }
}

/** Contrôle côté base que la session est bien administrateur, avant toute écriture. */
export async function assertAdmin(): Promise<string | null> {
  try {
    const { data, error } = await getSupabase().rpc('is_admin');
    if (error || data !== true) return 'Action réservée aux administrateurs.';
    return null;
  } catch {
    return 'Impossible de vérifier vos droits. Réessayez.';
  }
}

/** Remplace uniquement la première image ; les images suivantes déjà enregistrées sont conservées. */
function mergeImages(first: string, existing: string[]): string[] {
  return first === '' ? existing.slice(1) : [first, ...existing.slice(1)];
}

const toColumns = (values: ProductFormValues, existingImages: string[] = []) => ({
  name: values.name,
  description: values.description === '' ? null : values.description,
  price_fcfa: values.price,
  category_id: values.categoryId,
  image_urls: mergeImages(values.imageUrl, existingImages),
});

export async function createProduct(values: ProductFormValues, publish: boolean): Promise<MutationResult<string>> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  const base = slugify(values.name) || 'produit';
  // En cas de collision d'identifiant (23505), on réessaie avec un suffixe.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { data, error } = await getSupabase()
        .from('products')
        .insert({ ...toColumns(values), slug, is_published: publish })
        .select('id')
        .single();
      if (!error && data) return { ok: true, data: String((data as { id: unknown }).id) };
      if (error?.code !== '23505') return { ok: false, message: describe(error) };
    } catch {
      return { ok: false, message: describe(null) };
    }
  }
  return { ok: false, message: describe({ code: '23505' }) };
}

async function updateRow(id: string, columns: Record<string, unknown>): Promise<MutationResult> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await getSupabase().from('products').update(columns).eq('id', id).select('id');
    if (error) return { ok: false, message: describe(error) };
    // La RLS filtre silencieusement les lignes non autorisées : zéro ligne = rien n'a été modifié.
    if (!data || data.length === 0) return { ok: false, message: 'Aucune modification enregistrée : produit introuvable ou droit refusé.' };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, message: describe(null) };
  }
}

/** Ne modifie que les colonnes du formulaire : slug, statut et stock restent intacts. */
export const updateProduct = (id: string, values: ProductFormValues, existingImages: string[]) =>
  updateRow(id, toColumns(values, existingImages));

export const setProductPublished = (id: string, published: boolean) => updateRow(id, { is_published: published });
