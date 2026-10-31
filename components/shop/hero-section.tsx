import { ArrowRight } from 'lucide-react';
import { ProductImage } from '@/components/shop/product-image';
import type { Banners } from '@/lib/banners';
import { SITE } from '@/lib/site';

const AVATARS = ['AM', 'KB', 'YS'];

export function HeroSection({ hero }: { hero: Banners['hero'] }) {
  return (
    <section id="accueil" className="scroll-mt-24 pb-10 pt-6 sm:pb-14 sm:pt-12">
      <div className="page-container grid items-center gap-10 lg:grid-cols-[45fr_55fr] lg:gap-[75px] lg:px-10">
        <div className="space-y-6">
          <p className="section-eyebrow">✦ {SITE.tagline}</p>
          <h1 className="text-[2.5rem] leading-[1.04] sm:text-6xl lg:text-[4rem]">
            Sublimez votre <em className="text-ring">intérieur.</em>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-[1.0625rem]">
            Découvrez du mobilier, de la décoration et des pièces uniques pour créer un intérieur qui vous ressemble.
          </p>
          <a
            href="#catalogue"
            className="inline-flex h-[52px] items-center gap-2.5 rounded-[13px] bg-primary px-6 font-semibold text-primary-foreground transition-all hover:-translate-y-px hover:bg-primary/90"
          >
            Découvrir la collection
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
          </a>
          <div className="flex items-center gap-3.5 pt-3 text-sm text-muted-foreground">
            <div className="flex">
              {AVATARS.map((initials) => (
                <span
                  key={initials}
                  aria-hidden
                  className="-ml-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full border-2 border-background bg-accent text-xs font-bold text-primary first:ml-0"
                >
                  {initials}
                </span>
              ))}
            </div>
            <span>+2 000 intérieurs inspirés</span>
          </div>
        </div>

        <div className="relative">
          <div className="aspect-[4/3] overflow-hidden rounded-[28px] sm:aspect-[5/4] lg:h-[560px] lg:aspect-auto">
            <ProductImage
              src={hero.image}
              alt="Salon chaleureux aménagé avec du mobilier Meritt Home"
              sizes="(min-width: 1024px) 55vw, 100vw"
              priority
            />
          </div>
          <div
            aria-hidden
            className="absolute right-4 top-4 flex h-[76px] w-[76px] items-center justify-center rounded-full bg-secondary text-center text-[9px] font-bold leading-relaxed tracking-[0.12em] sm:right-5 sm:top-5 sm:h-24 sm:w-24 sm:text-[11px]"
          >
            {hero.badge.split(' ').map((word, index) => (
              <span key={index} className="block">
                {word}
              </span>
            ))}
          </div>
          <a
            href="#categories"
            className="absolute bottom-4 left-4 flex flex-col gap-1 rounded-[20px] bg-background px-5 py-4 shadow-[0_10px_40px_rgba(0,0,0,0.12)] sm:bottom-5 sm:left-5"
          >
            <span className="text-xs font-semibold text-wood">Collection</span>
            <span className="text-lg font-bold">Éclat naturel</span>
            <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              Pièces choisies avec soin <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
