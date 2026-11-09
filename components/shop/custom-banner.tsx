import Link from 'next/link';
import { ArrowRight, Ruler } from 'lucide-react';
import { ProductImage } from '@/components/shop/product-image';
import { CUSTOM, CUSTOM_BANNER_IMAGE, CUSTOM_PATH } from '@/lib/site';

/**
 * Bannière « Création sur mesure » de l'accueil. L'image (public/sur-mesure.jpg) est posée en fond ;
 * un dégradé sombre garantit la lisibilité du texte : de gauche à droite sur ordinateur, de bas en haut sur mobile.
 */
export function CustomBanner() {
  return (
    <section aria-labelledby="custom-banner-title" className="py-6 sm:py-10">
      <div className="page-container lg:px-10">
        <div className="relative isolate flex min-h-[460px] items-end overflow-hidden rounded-[22px] bg-[#0f2f28] text-white sm:min-h-[420px] sm:items-center sm:rounded-[27px] lg:min-h-[480px]">
          <div className="absolute inset-0 -z-20">
            <ProductImage src={CUSTOM_BANNER_IMAGE} alt="" sizes="(min-width: 1280px) 1200px, 100vw" className="object-[70%_center]" />
          </div>
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0b2520] via-[#0b2520]/85 to-[#0b2520]/10 sm:bg-gradient-to-r sm:from-[#0b2520] sm:via-[#0b2520]/80 sm:to-transparent"
          />

          <div className="w-full space-y-4 px-6 pb-8 pt-40 sm:max-w-[640px] sm:space-y-5 sm:px-10 sm:py-12 lg:px-16">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#e9ded0]">
              <Ruler className="h-4 w-4" aria-hidden />
              {CUSTOM.name}
            </p>
            <h2 id="custom-banner-title" className="text-[1.75rem] leading-[1.12] text-white sm:text-[2.25rem] lg:text-[2.75rem]">
              {CUSTOM.bannerTitle}
            </h2>
            <p className="max-w-[54ch] text-[15px] leading-relaxed text-white/90 sm:text-base">{CUSTOM.bannerText}</p>
            <div className="flex flex-col gap-3 pt-1 sm:flex-row">
              <Link
                href={`${CUSTOM_PATH}#demande`}
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-[13px] bg-white px-6 text-sm font-bold tracking-wide text-[#0f2f28] transition-all hover:-translate-y-px"
              >
                {CUSTOM.primaryButton}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href={CUSTOM_PATH}
                className="inline-flex h-[52px] items-center justify-center rounded-[13px] border border-white/70 px-6 text-sm font-bold tracking-wide text-white transition-colors hover:bg-white/10"
              >
                {CUSTOM.secondaryButton}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
