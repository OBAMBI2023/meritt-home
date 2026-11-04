import { getSupabase } from '@/lib/supabase/client';
import type { Category, InventoryMode, Product, ProductAvailabilityData } from '@/lib/products';

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

/** Signal public « en stock » par produit (fonction get_catalogue_availability) ; jamais de quantité. */
type StockSignal = Map<string, boolean | null>;

function toAvailability(row: Record<string, unknown>, stock: StockSignal): ProductAvailabilityData | null {
  const mode = row.inventory_mode;
  if (mode !== 'tracked' && mode !== 'on_demand') return null; // base sans la migration stock hybride
  const inventoryMode: InventoryMode = mode;
  return {
    mode: inventoryMode,
    status: row.availability_status === 'unavailable' ? 'unavailable' : 'available',
    leadTime: nonEmptyString(row.lead_time) ? row.lead_time.trim() : null,
    inStock: inventoryMode === 'on_demand' ? null : (stock.get(String(row.id)) ?? null),
  };
}

function toProduct(row: unknown, stock: StockSignal): Product | null {
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
    availability: toAvailability(row, stock),
  };
}

const BASE_COLUMNS = 'id, slug, name, description, price_fcfa, image_urls, category_id, created_at';
const HYBRID_COLUMNS = `${BASE_COLUMNS}, inventory_mode, availability_status, lead_time`;

/** Colonne absente : la migration stock hybride n'est pas appliquée sur cette base (repli sur l'ancienne lecture). */
const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42703' || /inventory_mode|availability_status|lead_time/.test(error.message ?? ''));

async function readPublishedProducts(supabase: ReturnType<typeof getSupabase>) {
  const query = (columns: string) => supabase.from('products').select(columns).eq('is_published', true).order('created_at', { ascending: true });
  const hybrid = await query(HYBRID_COLUMNS);
  return isMissingColumn(hybrid.error) ? query(BASE_COLUMNS) : hybrid;
}

async function readStockSignal(supabase: ReturnType<typeof getSupabase>): Promise<StockSignal> {
  const signal: StockSignal = new Map();
  try {
    const { data, error } = await supabase.rpc('get_catalogue_availability');
    if (error || !Array.isArray(data)) return signal;
    for (const row of data as unknown[]) {
      if (isRecord(row) && nonEmptyString(row.product_id)) signal.set(row.product_id, typeof row.in_stock === 'boolean' ? row.in_stock : null);
    }
  } catch {
    // Signal indisponible : aucune mention de stock, et rien n'est bloqué côté interface (la base reste l'autorité).
  }
  return signal;
}

export async function fetchCatalogue(): Promise<Catalogue> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    throw new CatalogueError('config', 'Supabase n’est pas configuré.');
  }

  try {
    const [categoriesResult, productsResult, stock] = await Promise.all([
      supabase
        .from('categories')
        .select('id, name, slug, description, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      readPublishedProducts(supabase),
      readStockSignal(supabase),
    ]);

    if (categoriesResult.error || productsResult.error) {
      throw new CatalogueError('network', 'La lecture du catalogue a échoué.');
    }

    const rawCategories: unknown[] = categoriesResult.data ?? [];
    const rawProducts: unknown[] = productsResult.data ?? [];
    return {
      categories: rawCategories.map(toCategory).filter((category): category is Category => category !== null),
      products: rawProducts.map((row) => toProduct(row, stock)).filter((product): product is Product => product !== null),
    };
  } catch (error) {
    if (error instanceof CatalogueError) throw error;
    throw new CatalogueError('network', 'La lecture du catalogue a échoué.');
  }
}
