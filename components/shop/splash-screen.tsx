'use client';

import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/shop/logo';
import { SPLASH_SESSION_KEY } from '@/components/shop/splash-config';
import './splash-screen.css';

/** Durée minimale (depuis le début de la navigation) pendant laquelle le logo reste visible, en ms. */
const MIN_VISIBLE_MS = 800;
/** Départ forcé du fondu : 1100 ms + 400 ms de fondu = 1,5 s maximum. */
const MAX_VISIBLE_MS = 1100;

export function SplashScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const hiddenByCss = getComputedStyle(el).display === 'none';
    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
    } catch {
      // stockage indisponible : le splash se limite à ce chargement.
    }
    if (hiddenByCss) {
      setGone(true);
      return;
    }

    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      // Passé MAX_VISIBLE_MS, le repli CSS est déjà en cours : le remplacer rallongerait le splash.
      if (performance.now() < MAX_VISIBLE_MS) el.classList.add('is-leaving');
    };

    const timers: number[] = [];
    const leaveAfter = (ms: number) => timers.push(window.setTimeout(leave, Math.max(0, ms)));
    const onLoad = () => leaveAfter(MIN_VISIBLE_MS - performance.now());

    // Le logo reste visible au moins MIN_VISIBLE_MS depuis le début de la navigation (jamais de délai en plus),
    // et au plus MAX_VISIBLE_MS même si le chargement traîne.
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    leaveAfter(MAX_VISIBLE_MS - performance.now());

    return () => {
      window.removeEventListener('load', onLoad);
      timers.forEach(window.clearTimeout);
    };
  }, []);

  if (gone) return null;

  return (
    <div ref={ref} className="splash" aria-hidden="true" onAnimationEnd={(e) => (e.animationName === 'splash-out' || e.animationName === 'splash-leave') && setGone(true)}>
      <div className="splash__logo">
        <Logo variant="full" className="h-28 text-foreground sm:h-36" />
      </div>
    </div>
  );
}
