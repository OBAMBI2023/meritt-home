import { getSupabase } from '@/lib/supabase/client';

/**
 * Passage de commande côté boutique : tout passe par les fonctions SQL `create_order` et `get_checkout_config`.
 * Les prix, frais, totaux et la disponibilité sont recalculés par la base : ce que le navigateur affiche
 * (catalogue, frais) n'est qu'indicatif et n'est jamais envoyé comme montant.
 */

export type ReceptionMode = 'delivery' | 'pickup';

export interface CheckoutConfig {
  /** Frais de livraison actifs par commune ; vide tant qu'aucun tarif n'est saisi. */
  fees: { commune: string; fee: number }[];
  /** `null` tant que l'adresse officielle de retrait n'est pas confirmée. */
  pickupAddress: string | null;
}

export interface OrderInput {
  idempotencyKey: string;
  customerName: string;
  email: string;
  phone: string;
  mode: ReceptionMode;
  commune: string;
  address: string;
  notes: string;
  items: { productId: string; quantity: number }[];
  /** Champ piège : doit rester vide (un robot le remplit). */
  website: string;
}

export interface OrderConfirmation {
  reference: string;
  mode: ReceptionMode;
  paymentStatus: string;
  customerName: string;
  commune: string | null;
  address: string | null;
  pickupAddress: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: { name: string; unitPrice: number; quantity: number; lineTotal: number }[];
}

export type OrderResult = { ok: true; order: OrderConfirmation } | { ok: false; code: string; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** UUID v4 ; `crypto.randomUUID` n'existe qu'en contexte sécurisé (https ou localhost). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function fetchCheckoutConfig(): Promise<CheckoutConfig> {
  const { data, error } = await getSupabase().rpc('get_checkout_config');
  if (error || !isRecord(data)) throw new Error('config');
  const fees = Array.isArray(data.fees)
    ? data.fees.flatMap((row: unknown) => {
        if (!isRecord(row)) return [];
        const commune = str(row.commune);
        const fee = int(row.fee_fcfa);
        return commune && fee !== null ? [{ commune, fee }] : [];
      })
    : [];
  return { fees, pickupAddress: str(data.pickup_address) };
}

const MESSAGES: Record<string, string> = {
  REQUEST_REJECTED: 'La demande a été bloquée par le contrôle anti-robot. Rechargez la page puis réessayez.',
  INVALID_REQUEST: 'La demande est incomplète. Rechargez la page puis réessayez.',
  INVALID_CUSTOMER: 'Vos coordonnées sont invalides : vérifiez le nom, l’adresse e-mail et les notes.',
  INVALID_PHONE: 'Le numéro de téléphone est invalide : 10 chiffres, avec ou sans +225.',
  INVALID_ITEMS: 'Le panier est invalide (quantité de 1 à 10 par article). Vérifiez-le puis réessayez.',
  INVALID_FULFILLMENT: 'Le mode de réception choisi est invalide.',
  INVALID_ADDRESS: 'L’adresse de livraison est incomplète : indiquez la commune et une adresse précise.',
  RATE_LIMITED: 'Trop de commandes récentes avec ce numéro de téléphone. Réessayez plus tard ou contactez-nous.',
  PRODUCT_UNAVAILABLE: 'Un article de votre panier n’est plus disponible. Retirez-le puis réessayez.',
  STOCK_UNTRACKED: 'Un article de votre panier n’est pas commandable pour le moment. Contactez-nous.',
  INSUFFICIENT_STOCK: 'Le stock est insuffisant pour un article de votre panier. Réduisez la quantité puis réessayez.',
  NO_DELIVERY_FEE: 'La livraison n’est pas disponible pour cette commune. Choisissez une autre commune ou le retrait sur place.',
  AMOUNT_TOO_LARGE: 'Le montant de la commande est trop élevé. Réduisez le panier.',
};

// La réponse a pu se perdre alors que la commande existe : on ne prétend donc pas qu'elle n'a pas été créée.
// Réessayer est sans risque (même clé d'idempotence : jamais de doublon) ; sinon contacter la boutique.
const GENERIC =
  'La commande n’a pas pu être confirmée. Vérifiez votre connexion puis réessayez : un doublon est impossible. Si le problème persiste, contactez-nous.';

function parseOrder(data: unknown): OrderConfirmation | null {
  if (!isRecord(data)) return null;
  const reference = str(data.reference);
  const subtotal = int(data.subtotal_fcfa);
  const deliveryFee = int(data.delivery_fee_fcfa);
  const total = int(data.total_fcfa);
  if (!reference || subtotal === null || deliveryFee === null || total === null || !Array.isArray(data.items)) return null;
  const items = data.items.flatMap((row: unknown) => {
    if (!isRecord(row)) return [];
    const name = str(row.product_name);
    const unitPrice = int(row.unit_price_fcfa);
    const quantity = int(row.quantity);
    const lineTotal = int(row.line_total_fcfa);
    return name && unitPrice !== null && quantity !== null && lineTotal !== null ? [{ name, unitPrice, quantity, lineTotal }] : [];
  });
  if (items.length === 0 || items.length !== data.items.length) return null;
  return {
    reference,
    mode: data.fulfillment_method === 'pickup' ? 'pickup' : 'delivery',
    paymentStatus: str(data.payment_status) ?? 'pending',
    customerName: str(data.customer_name) ?? '',
    commune: str(data.delivery_commune),
    address: str(data.delivery_address),
    pickupAddress: str(data.pickup_address),
    subtotal,
    deliveryFee,
    total,
    items,
  };
}

/**
 * Crée la commande. Un succès n'est renvoyé que si la base a répondu avec une commande complète
 * (référence, lignes, montants) : aucune confirmation n'est inventée côté navigateur.
 */
export async function createOrder(input: OrderInput): Promise<OrderResult> {
  try {
    const { data, error } = await getSupabase().rpc('create_order', {
      p_idempotency_key: input.idempotencyKey,
      p_customer_name: input.customerName,
      p_customer_email: input.email,
      p_customer_phone: input.phone,
      p_fulfillment_method: input.mode,
      p_delivery_commune: input.mode === 'delivery' ? input.commune : null,
      p_delivery_address: input.mode === 'delivery' ? input.address : null,
      p_customer_notes: input.notes === '' ? null : input.notes,
      p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
      p_website: input.website,
    });
    if (error) {
      const code = typeof error.message === 'string' && error.message in MESSAGES ? error.message : 'UNKNOWN';
      return { ok: false, code, message: MESSAGES[code] ?? GENERIC };
    }
    const order = parseOrder(data);
    if (!order) return { ok: false, code: 'BAD_RESPONSE', message: GENERIC };
    return { ok: true, order };
  } catch {
    return { ok: false, code: 'NETWORK', message: GENERIC };
  }
}
