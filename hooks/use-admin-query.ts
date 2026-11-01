'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminQueryError } from '@/lib/admin/queries';

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'error'; code: string | null }
  | { status: 'ready'; data: T };

/** Charge une lecture administrateur (fonction stable définie dans lib/admin/queries.ts). */
export function useAdminQuery<T>(load: () => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', code: error instanceof AdminQueryError ? error.code : null });
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);
  return { state, reload };
}
