'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * État persisté dans localStorage, compatible avec le rendu serveur :
 * le premier rendu utilise toujours `initial`, la valeur stockée n'est lue
 * qu'après le montage (pas de désaccord d'hydratation).
 * Retourne `hydrated` pour masquer les compteurs tant que la lecture n'a pas eu lieu.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  sanitize: (raw: unknown) => T
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  const sanitizeRef = useRef(sanitize);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(sanitizeRef.current(JSON.parse(stored)));
    } catch {
      // Stockage indisponible ou contenu illisible : on garde la valeur initiale.
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Stockage plein ou bloqué : l'application reste utilisable sans persistance.
    }
  }, [hydrated, key, value]);

  return [value, setValue, hydrated];
}
