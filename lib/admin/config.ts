import { z } from 'zod';
import { assertAdmin, describe, type MutationResult } from '@/lib/admin/products';
import { AdminQueryError } from '@/lib/admin/queries';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Paramètres de commande (`order_settings`, `delivery_fees`) et stocks (`product_inventory`).
 * Lectures et écritures passent par la session de l'administrateur : la RLS (`is_admin()`) reste la barrière réelle.
 * Aucune fonction SQL supplémentaire n'est nécessaire : les droits et politiques posés par la migration suffisent.
 */

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;
const toRows = (data: unknown): Row[] => (Array.isArray(data) ? data.filter(isRow) : []);
const toStr = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const toInt = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function check(error: { code: string } | null): void {
  if (error) throw new AdminQueryError(error.code || null);
}

/* ------------------------------------------------------------------ */
/* Paramètres de commande                                              */
/* ------------------------------------------------------------------ */

export type StockPolicy = 'reject' | 'allow';

export interface OrderSettings {
  policy: StockPolicy;
  maxPerHour: number;
  maxPerDay: number;
  pickupAddress: string | null;
}

export interface DeliveryFee {
  commune: string;
  fee: number;
  active: boolean;
}

export async function fetchOrderSettings(): Promise<OrderSettings | null> {
  const { data, error } = await getSupabase()
    .from('order_settings')
    .select('untracked_stock_policy, max_orders_per_phone_per_hour, max_orders_per_phone_per_day, pickup_address')
    .limit(1);
  check(error);
  const row = toRows(data)[0];
  if (!row) return null;
  const policy = row.untracked_stock_policy === 'allow' ? 'allow' : row.untracked_stock_policy === 'reject' ? 'reject' : null;
  const maxPerHour = toInt(row.max_orders_per_phone_per_hour);
  const maxPerDay = toInt(row.max_orders_per_phone_per_day);
  if (!policy || maxPerHour === null || maxPerDay === null) return null;
  return { policy, maxPerHour, maxPerDay, pickupAddress: toStr(row.pickup_address) };
}

export async function fetchDeliveryFees(): Promise<DeliveryFee[]> {
  const { data, error } = await getSupabase().from('delivery_fees').select('commune, fee_fcfa, is_active').order('commune', { ascending: true }).limit(500);
  check(error);
  return toRows(data).flatMap((row) => {
    const commune = toStr(row.commune);
    const fee = toInt(row.fee_fcfa);
    return commune && fee !== null ? [{ commune, fee, active: row.is_active === true }] : [];
  });
}

export async function fetchOrderConfig(): Promise<{ settings: OrderSettings | null; fees: DeliveryFee[] }> {
  const [settings, fees] = await Promise.all([fetchOrderSettings(), fetchDeliveryFees()]);
  return { settings, fees };
}

/* ------------------------------------------------------------------ */
/* Écritures                                                           */
/* ------------------------------------------------------------------ */

export const feeFormSchema = z.object({
  commune: z.string().trim().min(2, 'Le nom de la commune doit contenir au moins 2 caractères.').max(80, 'Le nom de la commune est trop long (80 caractères maximum).'),
  fee: z
    .string()
    .trim()
    .min(1, 'Le tarif est obligatoire.')
    .regex(/^\d+$/, 'Le tarif doit être un nombre entier de FCFA (0 ou plus), sans décimales.')
    .transform(Number)
    .refine((value) => value <= 10_000_000, 'Le tarif est trop élevé (10 000 000 FCFA maximum).'),
});

export const pickupAddressSchema = z.string().trim().max(300, 'L’adresse est trop longue (300 caractères maximum).');

const describeConfig = (error: { code?: string; message?: string } | null) =>
  error?.code === '23505' ? 'Cette commune a déjà un tarif : modifiez-le dans la liste.' : describe(error);

async function writeOne(run: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, notFound: string): Promise<MutationResult> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await run();
    if (error) return { ok: false, message: describeConfig(error) };
    // La RLS filtre sans erreur : zéro ligne renvoyée = rien n'a été enregistré.
    if (!Array.isArray(data) || data.length === 0) return { ok: false, message: notFound };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, message: 'L’enregistrement a échoué. Vérifiez votre connexion puis réessayez.' };
  }
}

export function addDeliveryFee(commune: string, fee: number): Promise<MutationResult> {
  return writeOne(() => getSupabase().from('delivery_fees').insert({ commune, fee_fcfa: fee, is_active: true }).select('commune'), 'Aucun tarif enregistré : droit refusé.');
}

/** Le nom de la commune est la clé : il n'est pas modifiable, seuls le tarif et l'état le sont. */
export function updateDeliveryFee(commune: string, patch: { fee?: number; active?: boolean }): Promise<MutationResult> {
  const columns: Record<string, unknown> = {};
  if (patch.fee !== undefined) columns.fee_fcfa = patch.fee;
  if (patch.active !== undefined) columns.is_active = patch.active;
  return writeOne(() => getSupabase().from('delivery_fees').update(columns).eq('commune', commune).select('commune'), 'Aucune modification enregistrée : commune introuvable ou droit refusé.');
}

export function updatePickupAddress(address: string): Promise<MutationResult> {
  return writeOne(
    () => getSupabase().from('order_settings').update({ pickup_address: address === '' ? null : address }).eq('id', true).select('id'),
    'Aucune modification enregistrée : paramètres introuvables ou droit refusé.'
  );
}

export function updateStockPolicy(policy: StockPolicy): Promise<MutationResult> {
  return writeOne(
    () => getSupabase().from('order_settings').update({ untracked_stock_policy: policy }).eq('id', true).select('id'),
    'Aucune modification enregistrée : paramètres introuvables ou droit refusé.'
  );
}

/* ------------------------------------------------------------------ */
/* Stocks                                                              */
/* ------------------------------------------------------------------ */

/** État du stock d'un produit : « aucune ligne » (non suivi) et « quantité NULL » (inconnue) restent distincts de 0. */
export type StockState = 'untracked' | 'unknown' | 'zero' | 'tracked';

export interface StockProduct {
  productId: string;
  name: string;
  published: boolean;
  /** `undefined` : aucune ligne dans `product_inventory` ; `null` : ligne présente, quantité NULL. */
  quantity: number | null | undefined;
  state: StockState;
}

export async function fetchStockProducts(): Promise<StockProduct[]> {
  const supabase = getSupabase();
  const [products, inventory] = await Promise.all([
    supabase.from('products').select('id, name, is_published').order('name', { ascending: true }).limit(1000),
    supabase.from('product_inventory').select('product_id, stock_quantity').limit(2000),
  ]);
  check(products.error);
  check(inventory.error);
  const quantities = new Map<string, number | null>();
  for (const row of toRows(inventory.data)) {
    const id = toStr(row.product_id);
    if (id) quantities.set(id, toInt(row.stock_quantity));
  }
  return toRows(products.data).flatMap((row) => {
    const productId = toStr(row.id);
    const name = toStr(row.name);
    if (!productId || !name) return [];
    const quantity = quantities.has(productId) ? (quantities.get(productId) ?? null) : undefined;
    const state: StockState = quantity === undefined ? 'untracked' : quantity === null ? 'unknown' : quantity === 0 ? 'zero' : 'tracked';
    return [{ productId, name, published: row.is_published === true, quantity, state }];
  });
}

export const stockQuantitySchema = z
  .string()
  .trim()
  .min(1, 'Saisissez une quantité.')
  .regex(/^\d+$/, 'La quantité doit être un nombre entier positif ou nul, sans signe ni décimales.')
  .transform(Number)
  .refine((value) => value <= 1_000_000, 'Quantité trop élevée (1 000 000 maximum).');

/**
 * Enregistre une quantité. L'écriture est conditionnelle à la valeur vue par l'administrateur :
 * si une commande a modifié le stock entre-temps, rien n'est écrasé et l'utilisateur est invité à actualiser.
 */
export async function setStockQuantity(productId: string, quantity: number, previous: number | null | undefined): Promise<MutationResult> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  const supabase = getSupabase();
  try {
    if (previous === undefined) {
      const { data, error } = await supabase.from('product_inventory').insert({ product_id: productId, stock_quantity: quantity }).select('product_id');
      if (error) {
        return { ok: false, message: error.code === '23505' ? 'Une quantité a été enregistrée entre-temps : actualisez la liste.' : describe(error) };
      }
      return data && data.length > 0 ? { ok: true, data: undefined } : { ok: false, message: 'Aucune quantité enregistrée : droit refusé.' };
    }
    let query = supabase.from('product_inventory').update({ stock_quantity: quantity }).eq('product_id', productId);
    query = previous === null ? query.is('stock_quantity', null) : query.eq('stock_quantity', previous);
    const { data, error } = await query.select('product_id');
    if (error) return { ok: false, message: describe(error) };
    if (!data || data.length === 0) return { ok: false, message: 'Le stock a changé entre-temps (par exemple par une commande) : actualisez la liste, puis saisissez à nouveau la quantité.' };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, message: 'L’enregistrement a échoué. Vérifiez votre connexion puis réessayez.' };
  }
}
