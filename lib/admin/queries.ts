import { getSupabase } from '@/lib/supabase/client';

/**
 * Lectures du tableau de bord administrateur.
 *
 * Elles s'exécutent avec la session de l'utilisateur connecté : c'est la RLS qui décide de ce qui est
 * lisible. Seules les colonnes dont l'existence est établie par le schéma sont demandées, et aucune
 * donnée personnelle de client n'est lue dans M0.
 */

export class AdminQueryError extends Error {
  constructor(readonly code: string | null) {
    super('Lecture refusée ou échouée.');
    this.name = 'AdminQueryError';
  }
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;
const toRows = (data: unknown): Row[] => (Array.isArray(data) ? data.filter(isRow) : []);
const toStr = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const toInt = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function check(error: { code: string } | null): void {
  if (error) throw new AdminQueryError(error.code || null);
}

/* ------------------------------------------------------------------ */
/* Indicateurs                                                         */
/* ------------------------------------------------------------------ */

export type Metric = { ok: true; value: number; partial?: boolean } | { ok: false; code: string | null };

async function countOf(
  run: () => PromiseLike<{ count: number | null; error: { code: string } | null }>
): Promise<Metric> {
  try {
    const { count, error } = await run();
    if (error || count === null) return { ok: false, code: error?.code ?? null };
    return { ok: true, value: count };
  } catch {
    return { ok: false, code: null };
  }
}

export interface Overview {
  products: Metric;
  publishedProducts: Metric;
  categories: Metric;
  activeCategories: Metric;
  orders: Metric;
  pendingOrders: Metric;
  /** Chiffre d'affaires encaissé : somme de `total_fcfa` des commandes dont `payment_status = 'paid'`. */
  revenue: Metric;
}

const REVENUE_ROW_LIMIT = 1000;

export async function fetchOverview(): Promise<Overview> {
  const supabase = getSupabase();
  const head = { count: 'exact', head: true } as const;

  const revenue = async (): Promise<Metric> => {
    try {
      const { data, count, error } = await supabase
        .from('orders')
        .select('total_fcfa', { count: 'exact' })
        .eq('payment_status', 'paid')
        .limit(REVENUE_ROW_LIMIT);
      if (error) return { ok: false, code: error.code || null };
      const rows = toRows(data);
      const value = rows.reduce((sum, row) => sum + (toInt(row.total_fcfa) ?? 0), 0);
      return { ok: true, value, partial: (count ?? rows.length) > rows.length };
    } catch {
      return { ok: false, code: null };
    }
  };

  const [products, publishedProducts, categories, activeCategories, orders, pendingOrders, revenueMetric] =
    await Promise.all([
      countOf(() => supabase.from('products').select('id', head)),
      countOf(() => supabase.from('products').select('id', head).eq('is_published', true)),
      countOf(() => supabase.from('categories').select('id', head)),
      countOf(() => supabase.from('categories').select('id', head).eq('is_active', true)),
      countOf(() => supabase.from('orders').select('id', head)),
      countOf(() => supabase.from('orders').select('id', head).eq('status', 'pending')),
      revenue(),
    ]);

  return { products, publishedProducts, categories, activeCategories, orders, pendingOrders, revenue: revenueMetric };
}

/* ------------------------------------------------------------------ */
/* Produits, catégories, stocks                                        */
/* ------------------------------------------------------------------ */

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  published: boolean;
  categoryId: string | null;
  description: string | null;
  imageUrls: string[];
  createdAt: string | null;
  /** Colonnes du stock hybride présentes en base (migration-stock-hybride.sql appliquée). */
  hybrid: boolean;
  inventoryMode: 'tracked' | 'on_demand';
  availability: 'available' | 'unavailable';
  leadTime: string | null;
  /** product_inventory : `undefined` = aucune ligne ; `null` = ligne sans quantité ; nombre = quantité physique. */
  quantity: number | null | undefined;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  sortOrder: number;
  description: string | null;
}

const PRODUCT_COLUMNS = 'id, name, slug, price_fcfa, is_published, category_id, description, image_urls, created_at';

/** Dernier état connu du schéma : la migration du stock hybride est-elle appliquée ? (sert à l'écriture du formulaire) */
let hybridKnown: boolean | null = null;

async function loadProducts(): Promise<AdminProduct[]> {
  const supabase = getSupabase();
  const read = (columns: string) => supabase.from('products').select(columns).order('name', { ascending: true }).limit(500);
  let result = await read(`${PRODUCT_COLUMNS}, inventory_mode, availability_status, lead_time`);
  let hybrid = true;
  // Colonne absente : la migration n'est pas appliquée sur cette base ; on relit sans les colonnes du stock hybride.
  if (result.error && (result.error.code === '42703' || /inventory_mode|availability_status|lead_time/.test(result.error.message ?? ''))) {
    hybrid = false;
    result = await read(PRODUCT_COLUMNS);
  }
  check(result.error);
  hybridKnown = hybrid;
  const inventory = await supabase.from('product_inventory').select('product_id, stock_quantity').limit(2000);
  check(inventory.error);
  const quantities = new Map<string, number | null>();
  for (const row of toRows(inventory.data)) {
    const productId = toStr(row.product_id);
    if (productId) quantities.set(productId, toInt(row.stock_quantity));
  }
  return toRows(result.data).flatMap((row) => {
    const id = toStr(row.id);
    const name = toStr(row.name);
    const price = toInt(row.price_fcfa);
    if (!id || !name || price === null) return [];
    return [
      {
        id,
        name,
        slug: toStr(row.slug) ?? '',
        price,
        published: row.is_published === true,
        categoryId: toStr(row.category_id),
        description: toStr(row.description),
        imageUrls: Array.isArray(row.image_urls) ? row.image_urls.filter((url): url is string => typeof url === 'string') : [],
        createdAt: toStr(row.created_at),
        hybrid,
        inventoryMode: row.inventory_mode === 'on_demand' ? ('on_demand' as const) : ('tracked' as const),
        availability: row.availability_status === 'unavailable' ? ('unavailable' as const) : ('available' as const),
        leadTime: toStr(row.lead_time),
        quantity: quantities.has(id) ? (quantities.get(id) ?? null) : undefined,
      },
    ];
  });
}

async function loadCategories(): Promise<AdminCategory[]> {
  const { data, error } = await getSupabase()
    .from('categories')
    .select('id, name, slug, is_active, sort_order, description')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(200);
  check(error);
  return toRows(data).flatMap((row) => {
    const id = toStr(row.id);
    const name = toStr(row.name);
    if (!id || !name) return [];
    return [{ id, name, slug: toStr(row.slug) ?? '', active: row.is_active === true, sortOrder: toInt(row.sort_order) ?? 0, description: toStr(row.description) }];
  });
}

export const fetchAdminProducts = loadProducts;

export async function fetchProductsAndCategories(): Promise<{ products: AdminProduct[]; categories: AdminCategory[]; hybrid: boolean }> {
  const [products, categories] = await Promise.all([loadProducts(), loadCategories()]);
  return { products, categories, hybrid: hybridKnown === true };
}

export async function fetchAdminCategories(): Promise<{ categories: AdminCategory[]; products: AdminProduct[] }> {
  const [categories, products] = await Promise.all([loadCategories(), loadProducts()]);
  return { categories, products };
}

export interface StockRow {
  productId: string;
  name: string;
  /** `null` : aucune quantité renseignée pour ce produit. */
  quantity: number | null;
  tracked: boolean;
}

export async function fetchStock(): Promise<StockRow[]> {
  const [products, inventory] = await Promise.all([
    loadProducts(),
    getSupabase().from('product_inventory').select('product_id, stock_quantity').limit(1000),
  ]);
  check(inventory.error);
  const quantities = new Map<string, number | null>();
  for (const row of toRows(inventory.data)) {
    const productId = toStr(row.product_id);
    if (productId) quantities.set(productId, toInt(row.stock_quantity));
  }
  return products.map((product) => ({
    productId: product.id,
    name: product.name,
    quantity: quantities.get(product.id) ?? null,
    tracked: quantities.has(product.id),
  }));
}

/* ------------------------------------------------------------------ */
/* Commandes (lecture seule, sans données personnelles)                */
/* ------------------------------------------------------------------ */

export interface AdminOrderItem {
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface AdminOrder {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  total: number;
  subtotal: number;
  deliveryFee: number;
  mode: 'delivery' | 'pickup';
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  commune: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string | null;
  items: AdminOrderItem[];
}

export async function fetchOrders(): Promise<{ orders: AdminOrder[]; total: number | null }> {
  const { data, count, error } = await getSupabase()
    .from('orders')
    .select(
      'id, reference, status, payment_status, total_fcfa, subtotal_fcfa, delivery_fee_fcfa, fulfillment_method, customer_name, customer_email, customer_phone, delivery_commune, delivery_address, customer_notes, created_at, order_items(product_name, unit_price_fcfa, quantity, line_total_fcfa)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .limit(100);
  check(error);
  const orders = toRows(data).flatMap((row) => {
    const id = toStr(row.id);
    const reference = toStr(row.reference);
    const total = toInt(row.total_fcfa);
    const subtotal = toInt(row.subtotal_fcfa);
    const deliveryFee = toInt(row.delivery_fee_fcfa);
    if (!id || !reference || total === null || subtotal === null || deliveryFee === null) return [];
    const items = toRows(row.order_items).flatMap((item) => {
      const name = toStr(item.product_name);
      const unitPrice = toInt(item.unit_price_fcfa);
      const quantity = toInt(item.quantity);
      const lineTotal = toInt(item.line_total_fcfa);
      return name && unitPrice !== null && quantity !== null && lineTotal !== null ? [{ name, unitPrice, quantity, lineTotal }] : [];
    });
    return [
      {
        id,
        reference,
        status: toStr(row.status) ?? '—',
        paymentStatus: toStr(row.payment_status) ?? '—',
        total,
        subtotal,
        deliveryFee,
        mode: row.fulfillment_method === 'pickup' ? ('pickup' as const) : ('delivery' as const),
        customerName: toStr(row.customer_name) ?? '—',
        customerEmail: toStr(row.customer_email) ?? '—',
        customerPhone: toStr(row.customer_phone) ?? '—',
        commune: toStr(row.delivery_commune),
        address: toStr(row.delivery_address),
        notes: toStr(row.customer_notes),
        createdAt: toStr(row.created_at),
        items,
      },
    ];
  });
  return { orders, total: count };
}
