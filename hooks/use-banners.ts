'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_BANNERS, fetchBanners, type Banners } from '@/lib/banners';

/**
 * Bannières de la boutique : valeurs par défaut immédiatement, puis celles de la base une fois chargées.
 * `loaded` passe à true quand la lecture est terminée (réussie ou retombée sur les valeurs par défaut) :
 * la campagne de Noël attend ce signal pour ne pas apparaître une fraction de seconde alors qu'elle est désactivée ou hors période.
 */
export function useBannersState(): { banners: Banners; loaded: boolean } {
  const [state, setState] = useState<{ banners: Banners; loaded: boolean }>({ banners: DEFAULT_BANNERS, loaded: false });
  useEffect(() => {
    let cancelled = false;
    void fetchBanners().then((banners) => {
      if (!cancelled) setState({ banners, loaded: true });
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
