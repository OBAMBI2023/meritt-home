'use client';

import { useCallback, useEffect, useState } from 'react';
import { CatalogueError, fetchCatalogue } from '@/lib/catalogue';
import type { Category, Product } from '@/lib/products';

export type CatalogueState =
  | { status: 'loading' }
  | { status: 'error'; kind: 'config' | 'network' }
  | { status: 'ready'; categories: Category[]; products: Product[] };

export function useCatalogue() {
  const [state, setState] = useState<CatalogueState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchCatalogue()
      .then((catalogue) => {
        if (!cancelled) setState({ status: 'ready', ...catalogue });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', kind: error instanceof CatalogueError ? error.kind : 'network' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  return { state, reload };
}
