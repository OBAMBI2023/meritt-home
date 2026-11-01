'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_BANNERS, fetchBanners, type Banners } from '@/lib/banners';

interface BannersState {
  banners: Banners;
  /** La lecture est terminée (réussie ou non). */
  loaded: boolean;
  /** La base a confirmé les réglages. Faux = valeurs locales de secours uniquement (campagne de Noël masquée). */
  confirmed: boolean;
}

/**
 * Bannières de la boutique : valeurs par défaut immédiatement (pour les bannières ordinaires), puis celles de la base.
 * La campagne de Noël, elle, n'est jamais affichée tant que `confirmed` n'est pas vrai.
 */
export function useBannersState(): BannersState {
  const [state, setState] = useState<BannersState>({ banners: DEFAULT_BANNERS, loaded: false, confirmed: false });
  useEffect(() => {
    let cancelled = false;
    void fetchBanners().then(({ banners, confirmed }) => {
      if (!cancelled) setState({ banners, loaded: true, confirmed });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function useBanners(): Banners {
  return useBannersState().banners;
}
