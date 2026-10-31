import type { Product } from '@/lib/products';

/** Limite d'interface par article (ce n'est pas un stock). */
export const MAX_QUANTITY = 10;

/** Les identifiants de produits sont des UUID Supabase ; tout autre format (anciens slugs) est ignoré. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isProductId = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface DetailedCartLine {
  product: Product;
  quantity: number;
  lineTotal: number;
}

const clampQuantity = (quantity: number) =>
  Math.min(MAX_QUANTITY, Math.max(0, Math.floor(quantity)));

export function addToCart(lines: CartLine[], productId: string, quantity = 1): CartLine[] {
  if (!isProductId(productId)) return lines;
  const existing = lines.find((line) => line.productId === productId);
  if (!existing) return [...lines, { productId, quantity: clampQuantity(quantity) }];
  return lines.map((line) =>
    line.productId === productId ? { ...line, quantity: clampQuantity(line.quantity + quantity) } : line
  );
}

/** Une quantité nulle ou négative retire la ligne. */
export function setQuantity(lines: CartLine[], productId: string, quantity: number): CartLine[] {
  const next = clampQuantity(quantity);
  if (next <= 0) return lines.filter((line) => line.productId !== productId);
  return lines.map((line) => (line.productId === productId ? { ...line, quantity: next } : line));
}

export function removeFromCart(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

/** Associe chaque ligne à son produit du catalogue ; les produits absents (supprimés, dépubliés) sont écartés. */
export function detailLines(lines: CartLine[], products: Product[]): DetailedCartLine[] {
  return lines.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ product, quantity: line.quantity, lineTotal: product.price * line.quantity }] : [];
  });
}

export const countItems = (details: DetailedCartLine[]) =>
  details.reduce((sum, line) => sum + line.quantity, 0);

/** Sous-total indicatif du panier. Les frais de livraison dépendent de la commune et sont fixés par la base à la commande. */
export function computeTotals(details: DetailedCartLine[]) {
  const subtotal = details.reduce((sum, line) => sum + line.lineTotal, 0);
  return { subtotal };
}

/**
 * Valide la structure d'un panier relu depuis le stockage local (avant que le catalogue soit chargé) :
 * identifiants non UUID (anciens paniers v1 en slugs), doublons et quantités invalides sont écartés.
 */
export function sanitizeCart(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: CartLine[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { productId, quantity } = entry as Record<string, unknown>;
    if (!isProductId(productId) || typeof quantity !== 'number' || !Number.isFinite(quantity)) continue;
    if (lines.some((line) => line.productId === productId)) continue;
    const clamped = clampQuantity(quantity);
    if (clamped > 0) lines.push({ productId, quantity: clamped });
  }
  return lines;
}

export function sanitizeFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter(isProductId)));
}
