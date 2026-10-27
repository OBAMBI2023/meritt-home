import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImage } from '@/components/shop/product-image';
import { SITE } from '@/lib/site';

export function HeroSection() {
  return (
    <section id="accueil" className="scroll-mt-24 pb-12 pt-8 sm:pb-16 sm:pt-12 lg:pb-20">
      <div className="page-container grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="space-y-6">
          <p className="section-eyebrow">{SITE.tagline}</p>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl">
            Sublimez votre <span className="italic text-primary">intérieur.</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">{SITE.description}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-7">
              <a href="#catalogue">
                Découvrir le catalogue
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-7">
              <a href="#categories">Explorer les catégories</a>
            </Button>
          </div>
        </div>

        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-sm lg:aspect-[5/4]">
          <ProductImage
            src={SITE.heroImage}
            alt="Salon chaleureux aménagé avec du mobilier Meritt Home"
            sizes="(min-width: 1024px) 50vw, 100vw"
            priority
          />
        </div>
      </div>
    </section>
  );
}
