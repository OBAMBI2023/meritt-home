'use client';

import { useCallback, useMemo } from 'react';
import {
  addToCart,
  computeTotals,
  countItems,
  detailLines,
  removeFromCart,
  sanitizeCart,
  setQuantity,
  type CartLine,
} from '@/lib/cart';
import type { Product } from '@/lib/products';
import { usePersistentState } from '@/hooks/use-persistent-state';

/** Version 2 : identifiants UUID Supabase. Les anciens paniers v1 (slugs) ne sont plus lus. */
const STORAGE_KEY = 'meritt-home:cart:v2';

export function useCart(products: Product[]) {
  const [lines, setLines, hydrated] = usePersistentState<CartLine[]>(STORAGE_KEY, [], sanitizeCart);

  const add = useCallback((productId: string) => setLines((current) => addToCart(current, productId)), [setLines]);
  const update = useCallback(
    (productId: string, quantity: number) => setLines((current) => setQuantity(current, productId, quantity)),
    [setLines]
  );
  const remove = useCallback((productId: string) => setLines((current) => removeFromCart(current, productId)), [setLines]);
  const clear = useCallback(() => setLines([]), [setLines]);

  // Seules les lignes dont le produit existe dans le catalogue sont affichées et comptées.
  const details = useMemo(() => detailLines(lines, products), [lines, products]);
  const totals = useMemo(() => computeTotals(details), [details]);

  /** Retire du panier les produits absents du catalogue chargé ; retourne leur nombre. */
  const pruneUnavailable = useCallback(
    (available: Product[]) => {
      const kept = lines.filter((line) => available.some((product) => product.id === line.productId));
      if (kept.length !== lines.length) setLines(kept);
      return lines.length - kept.length;
    },
    [lines, setLines]
  );

  return { lines, details, totals, count: countItems(details), hydrated, add, update, remove, clear, pruneUnavailable };
}
