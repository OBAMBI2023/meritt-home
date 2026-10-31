import { ProductImage } from '@/components/shop/product-image';
import type { Banners } from '@/lib/banners';

export function PromoBanner({ promo }: { promo: Banners['promo'] }) {
  return (
    <section className="py-6 sm:py-10">
      <div className="page-container lg:px-10">
        <div
          className="grid items-center gap-8 overflow-hidden rounded-[22px] px-6 py-7 sm:rounded-[27px] sm:px-10 md:grid-cols-2 lg:gap-10 lg:px-16 lg:py-11"
          style={{ backgroundColor: promo.bg, color: promo.fg }}
        >
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: promo.accent }}>
              {promo.eyebrow}
            </p>
            <h2 className="text-[2rem] leading-[1.1] lg:text-[2.75rem]" style={{ color: promo.fg }}>
              {promo.title} <em style={{ color: promo.accent }}>{promo.highlight}</em>
              <br />
              {promo.subtitle}
            </h2>
            <p className="opacity-80">{promo.text}</p>
            <a
              href="#catalogue"
              className="inline-flex h-[52px] items-center rounded-[13px] bg-white px-6 font-semibold transition-all hover:-translate-y-px"
              style={{ color: promo.bg }}
            >
              {promo.button}
            </a>
          </div>
          <div className="relative">
            <div className="h-[200px] overflow-hidden rounded-[22px] md:h-[300px]">
              <ProductImage src={promo.image} alt="" sizes="(min-width: 768px) 40vw, 100vw" />
            </div>
            <span
              aria-hidden
              className="absolute -left-3 -top-3 flex h-[90px] w-[90px] items-center justify-center rounded-full bg-wood text-center text-[11px] font-bold leading-snug tracking-[0.1em] text-white md:-left-[18px] md:-top-[18px]"
            >
              <span>
                {promo.orbit.split(' ').map((word, index) => (
                  <span key={index} className="block">
                    {word}
                  </span>
                ))}
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
