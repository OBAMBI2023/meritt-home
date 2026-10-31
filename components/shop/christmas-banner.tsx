'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { ProductImage } from '@/components/shop/product-image';
import { isChristmasActive, type Banners } from '@/lib/banners';

/** Palette de la campagne (tokens propres à la bannière, séparés du thème du site). */
const FIR = '#123D2A';
const BORDEAUX = '#8B1E2D';
const GOLD = '#D6B46A';
const IVORY = '#FFF9F0';

// Position des guirlandes (x, y) sur le sapin du décor intégré.
const LIGHTS: [number, number][] = [
  [262, 120], [286, 150], [238, 158], [300, 196], [262, 206], [224, 200], [320, 244], [276, 252], [232, 250], [188, 246],
];
const FLAKES = [8, 18, 29, 41, 52, 63, 74, 85, 93];

/** Mise en valeur du mot « NOËL » dans le titre, sans toucher au texte saisi. */
function Title({ text }: { text: string }) {
  return (
    <>
      {text.split(/(NOËL)/i).map((part, index) =>
        /^NOËL$/i.test(part) ? (
          <em key={index} className="not-italic" style={{ color: GOLD }}>
            {part}
          </em>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

/** Décor vectoriel léger (aucune photo) : sapin illuminé, cadeaux et canapé en silhouette. Purement décoratif. */
function Scene() {
  return (
    <svg viewBox="0 0 400 340" preserveAspectRatio="xMidYMax meet" className="h-full w-full" aria-hidden focusable="false">
      <defs>
        <radialGradient id="xmas-glow" cx="62%" cy="58%" r="40%">
          <stop offset="0" stopColor={GOLD} stopOpacity="0.32" />
          <stop offset="1" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="340" fill="url(#xmas-glow)" />
      {/* sol */}
      <ellipse cx="230" cy="318" rx="190" ry="14" fill="#000" opacity="0.22" />
      {/* canapé (silhouette discrète) */}
      <g fill={IVORY} opacity="0.1">
        <rect x="14" y="228" width="170" height="70" rx="16" />
        <rect x="26" y="204" width="146" height="44" rx="14" />
        <rect x="4" y="236" width="26" height="62" rx="12" />
        <rect x="168" y="236" width="26" height="62" rx="12" />
      </g>
      {/* sapin */}
      <rect x="252" y="284" width="20" height="32" rx="3" fill="#5a3a22" />
      <polygon points="262,56 330,176 194,176" fill="#1d5a3e" />
      <polygon points="262,110 346,232 178,232" fill="#194f37" />
      <polygon points="262,168 360,292 164,292" fill="#154530" />
      <polygon points="262,36 267,52 284,52 270,62 275,78 262,68 249,78 254,62 240,52 257,52" fill={GOLD} />
      {/* guirlandes */}
      {LIGHTS.map(([cx, cy], index) => (
        <circle key={index} cx={cx} cy={cy} r="4" fill={GOLD} className="xmas-twinkle" style={{ animationDelay: `${(index % 5) * 0.55}s` }} />
      ))}
      {/* boules */}
      <circle cx="244" cy="184" r="6.5" fill={BORDEAUX} />
      <circle cx="300" cy="224" r="6.5" fill={BORDEAUX} />
      <circle cx="214" cy="270" r="6.5" fill={BORDEAUX} />
      <circle cx="318" cy="276" r="6.5" fill={GOLD} />
      {/* cadeaux */}
      <g>
        <rect x="150" y="272" width="46" height="44" rx="4" fill={BORDEAUX} />
        <rect x="170" y="272" width="6" height="44" fill={GOLD} />
        <rect x="150" y="290" width="46" height="6" fill={GOLD} />
        <rect x="334" y="286" width="38" height="30" rx="4" fill={IVORY} />
        <rect x="349" y="286" width="6" height="30" fill={BORDEAUX} />
        <rect x="204" y="298" width="30" height="18" rx="3" fill={GOLD} />
        <rect x="216" y="298" width="5" height="18" fill={BORDEAUX} />
      </g>
    </svg>
  );
}

/** `christmas` vaut null tant que les réglages ne sont pas chargés : rien n'est affiché (pas de scintillement). */
export function ChristmasBanner({ christmas }: { christmas: Banners['christmas'] | null }) {
  // La date du jour est celle du visiteur (AAAA-MM-JJ) : on ne la lit qu'après l'hydratation,
  // sinon la date du serveur (UTC) pourrait différer de celle du navigateur et provoquer une erreur d'hydratation.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setToday(new Date().toLocaleDateString('sv-SE'));
    refresh();
    // Changement de jour à minuit (heure locale du visiteur) sans recharger la page : minuterie vers le prochain minuit,
    // plus un recalcul au retour sur l'onglet (une minuterie peut être retardée pendant la veille de l'appareil).
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 500);
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, nextMidnight.getTime() - now.getTime());
    };
    schedule();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (christmas === null || today === null || !isChristmasActive(christmas, today)) return null;

  return (
    <section aria-labelledby="noel-title" className="py-6 sm:py-10">
      <div className="page-container lg:px-10">
        <div
          className="relative isolate grid overflow-hidden rounded-[22px] sm:rounded-[28px] md:min-h-[400px] md:grid-cols-[1.05fr_1fr]"
          style={{ background: `linear-gradient(115deg, #0b2a1d 0%, ${FIR} 48%, #1a4a35 100%)`, color: IVORY }}
        >
          {/* Fond : photo éventuelle (gérée dans l'administration) ou décor intégré */}
          <div aria-hidden className="absolute inset-y-0 right-0 -z-10 hidden w-[62%] md:block">
            {christmas.image ? (
              <>
                <ProductImage src={christmas.image} alt="" sizes="(min-width: 768px) 60vw, 100vw" />
                <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${FIR} 0%, rgba(18,61,42,0.55) 38%, rgba(18,61,42,0) 100%)` }} />
              </>
            ) : (
              <Scene />
            )}
          </div>

          {/* Particules : transformations uniquement, désactivées si l'utilisateur réduit les animations */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            {FLAKES.map((left, index) => (
              <span
                key={left}
                className="xmas-flake absolute top-0 block rounded-full bg-white/70"
                style={{
                  left: `${left}%`,
                  width: index % 3 === 0 ? 5 : 3,
                  height: index % 3 === 0 ? 5 : 3,
                  animationDuration: `${9 + (index % 4) * 3}s`,
                  animationDelay: `${-index * 1.7}s`,
                  opacity: 0.55,
                }}
              />
            ))}
          </div>

          <div className="xmas-rise relative z-10 flex flex-col items-start justify-center gap-5 px-6 py-9 sm:px-10 sm:py-12 lg:px-14">
            <p
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] ring-1"
              style={{ backgroundColor: BORDEAUX, color: IVORY, ['--tw-ring-color' as string]: GOLD }}
            >
              <span aria-hidden style={{ color: GOLD }}>✦</span>
              {christmas.badge}
            </p>
            <h2 id="noel-title" className="max-w-xl text-[1.75rem] font-bold leading-[1.1] tracking-[-0.02em] sm:text-4xl lg:text-[2.9rem]" style={{ color: IVORY }}>
              <Title text={christmas.title} />
            </h2>
            <p className="max-w-md text-base leading-relaxed sm:text-lg" style={{ color: 'rgba(255,249,240,0.86)' }}>
              {christmas.subtitle}
            </p>
            <a
              href={christmas.href}
              className="group inline-flex min-h-[52px] items-center gap-2.5 rounded-[13px] px-6 text-sm font-bold tracking-[0.06em] shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
              style={{ backgroundColor: GOLD, color: FIR, ['--tw-ring-color' as string]: IVORY, ['--tw-ring-offset-color' as string]: FIR }}
            >
              {christmas.button}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
            </a>
          </div>

          {/* Visuel mobile : sous le texte */}
          <div aria-hidden className="relative -z-10 h-56 md:hidden">
            {christmas.image ? (
              <>
                <ProductImage src={christmas.image} alt="" sizes="100vw" />
                <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${FIR} 0%, rgba(18,61,42,0) 45%)` }} />
              </>
            ) : (
              <Scene />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
