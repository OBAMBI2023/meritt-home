import { z } from 'zod';
import { assertAdmin, describe, slugify, type MutationResult } from '@/lib/admin/products';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Écritures sur `public.categories` avec la session de l'administrateur connecté.
 * Colonnes utilisées (établies par le schéma) : name, slug, description, is_active, sort_order.
 * La RLS reste la protection réelle ; aucune suppression n'est proposée.
 */

export const categoryFormSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.').max(80, 'Le nom est trop long (80 caractères maximum).'),
  description: z.string().trim().max(500, 'La description est trop longue (500 caractères maximum).'),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, 'L’ordre doit être un entier positif (0 à 9999).')
    .transform(Number),
  active: z.boolean(),
});

export type CategoryFormInput = z.input<typeof categoryFormSchema>;
export type CategoryFormValues = z.output<typeof categoryFormSchema>;

const toColumns = (values: CategoryFormValues) => ({
  name: values.name,
  description: values.description === '' ? null : values.description,
  sort_order: values.sortOrder,
  is_active: values.active,
});

export async function createCategory(values: CategoryFormValues): Promise<MutationResult> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  const base = slugify(values.name) || 'categorie';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { error } = await getSupabase().from('categories').insert({ ...toColumns(values), slug });
      if (!error) return { ok: true, data: undefined };
      if (error.code !== '23505') return { ok: false, message: describe(error) };
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
    const { data, error } = await getSupabase().from('categories').update(columns).eq('id', id).select('id');
    if (error) return { ok: false, message: describe(error) };
    if (!data || data.length === 0) return { ok: false, message: 'Aucune modification enregistrée : catégorie introuvable ou droit refusé.' };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, message: describe(null) };
  }
}

/** Le slug n'est jamais modifié : il reste stable pour les liens existants. */
export const updateCategory = (id: string, values: CategoryFormValues) => updateRow(id, toColumns(values));

export const setCategoryActive = (id: string, active: boolean) => updateRow(id, { is_active: active });
