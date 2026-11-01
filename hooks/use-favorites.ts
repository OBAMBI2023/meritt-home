'use client';

import { useCallback } from 'react';
import { sanitizeFavorites } from '@/lib/cart';
import type { Product } from '@/lib/products';
import { usePersistentState } from '@/hooks/use-persistent-state';

/** Version 2 : identifiants UUID Supabase. Les anciens favoris v1 (slugs) ne sont plus lus. */
const STORAGE_KEY = 'meritt-home:favorites:v2';

export function useFavorites() {
  const [ids, setIds, hydrated] = usePersistentState<string[]>(STORAGE_KEY, [], sanitizeFavorites);

  const toggle = useCallback(
    (productId: string) =>
      setIds((current) =>
        current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
      ),
    [setIds]
  );

  /** Retire les favoris dont le produit n'est plus au catalogue. */
  const pruneUnavailable = useCallback(
    (available: Product[]) => {
      const kept = ids.filter((id) => available.some((product) => product.id === id));
      if (kept.length !== ids.length) setIds(kept);
    },
    [ids, setIds]
  );

  return { ids, hydrated, toggle, pruneUnavailable };
}
