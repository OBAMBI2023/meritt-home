import { getSupabase } from '@/lib/supabase/client';
import type { Category, Product } from '@/lib/products';

/**
 * Lecture publique du catalogue (clé publishable uniquement).
 * Seules les catégories actives et les produits publiés sont demandés ;
 * la politique RLS reste la protection réelle côté base.
 */

export interface Catalogue {
  categories: Category[];
  products: Product[];
}

export class CatalogueError extends Error {
  constructor(
    readonly kind: 'config' | 'network',
    message: string
  ) {
    super(message);
    this.name = 'CatalogueError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** N'accepte que des URL http(s) ou des chemins du site : next/image refuse tout le reste. */
function usableImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function toCategory(row: unknown): Category | null {
  if (!isRecord(row) || !nonEmptyString(row.id) || !nonEmptyString(row.slug) || !nonEmptyString(row.name)) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: nonEmptyString(row.description) ? row.description : null,
  };
}

function toProduct(row: unknown): Product | null {
  if (!isRecord(row) || !nonEmptyString(row.id) || !nonEmptyString(row.slug) || !nonEmptyString(row.name)) return null;
  const price = row.price_fcfa;
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) return null;
  const images = Array.isArray(row.image_urls) ? row.image_urls.map(usableImageUrl).filter((url): url is string => url !== null) : [];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryId: nonEmptyString(row.category_id) ? row.category_id : null,
    price,
    image: images[0] ?? null,
    description: nonEmptyString(row.description) ? row.description : null,
  };
}

export async function fetchCatalogue(): Promise<Catalogue> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    throw new CatalogueError('config', 'Supabase n’est pas configuré.');
  }

  try {
    const [categoriesResult, productsResult] = await Promise.all([
      supabase
        .from('categories')
        .select('id, name, slug, description, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('products')
        .select('id, slug, name, description, price_fcfa, image_urls, category_id, created_at')
        .eq('is_published', true)
        .order('created_at', { ascending: true }),
    ]);

    if (categoriesResult.error || productsResult.error) {
      throw new CatalogueError('network', 'La lecture du catalogue a échoué.');
    }

    const rawCategories: unknown[] = categoriesResult.data ?? [];
    const rawProducts: unknown[] = productsResult.data ?? [];
    return {
      categories: rawCategories.map(toCategory).filter((category): category is Category => category !== null),
      products: rawProducts.map(toProduct).filter((product): product is Product => product !== null),
    };
  } catch (error) {
    if (error instanceof CatalogueError) throw error;
    throw new CatalogueError('network', 'La lecture du catalogue a échoué.');
  }
}
