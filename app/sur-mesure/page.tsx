import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, FileSearch, Hammer, ImagePlus } from 'lucide-react';
import { CustomRequestFormSection } from '@/components/custom/custom-request-form';
import { ProductImage } from '@/components/shop/product-image';
import { SiteFooter } from '@/components/shop/site-footer';
import { SiteHeader } from '@/components/shop/site-header';
import { WhatsAppButton } from '@/components/shop/whatsapp-button';
import { CUSTOM, CUSTOM_BANNER_IMAGE, CUSTOM_PATH, SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `${CUSTOM.name} — ${SITE.name}`,
  description: CUSTOM.subtitle,
  alternates: { canonical: CUSTOM_PATH },
};

const STEPS = [
  { icon: ImagePlus, title: 'Partagez votre inspiration', text: 'Un lien Pinterest, Instagram ou TikTok, des photos, vos dimensions : tout ce qui nous aide à comprendre votre idée.' },
  { icon: FileSearch, title: 'Nous étudions votre projet', text: 'Notre équipe analyse la faisabilité, les matériaux et vos contraintes, puis revient vers vous.' },
  { icon: ClipboardList, title: 'Vous recevez un devis', text: 'Une proposition personnalisée, adaptée à votre espace et à votre budget. Vous décidez ensuite, sans engagement.' },
  { icon: Hammer, title: 'Nous donnons vie à votre idée', text: 'Si le devis vous convient, la création est lancée et suivie avec vous jusqu’à la livraison.' },
];

export default function CustomPage() {
  return (
    <>
      <SiteHeader showCategories={false} basePath="/" current="custom" />

      <main id="accueil">
        <section className="relative isolate overflow-hidden bg-[#0f2f28] text-white">
          <div className="absolute inset-0 -z-20">
            <ProductImage src={CUSTOM_BANNER_IMAGE} alt="" sizes="100vw" priority className="object-[70%_center]" />
          </div>
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0b2520] via-[#0b2520]/85 to-[#0b2520]/30 sm:bg-gradient-to-r sm:from-[#0b2520] sm:via-[#0b2520]/85 sm:to-[#0b2520]/10" />
          <div className="page-container space-y-5 py-14 sm:py-20 lg:px-10 lg:py-24">
            <Link href="/" className="inline-flex min-h-[2.75rem] items-center gap-2 text-sm font-medium text-white/85 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Retour à la boutique
            </Link>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e9ded0]">{CUSTOM.name}</p>
            <h1 className="max-w-[18ch] text-[2.25rem] leading-[1.08] text-white sm:text-5xl lg:text-[3.5rem]">{CUSTOM.tagline}</h1>
            <p className="max-w-[58ch] text-base leading-relaxed text-white/90 sm:text-lg">{CUSTOM.subtitle}</p>
            <a
              href="#demande"
              className="inline-flex h-[52px] items-center rounded-[13px] bg-white px-6 text-sm font-bold tracking-wide text-[#0f2f28] transition-all hover:-translate-y-px"
            >
              {CUSTOM.primaryButton}
            </a>
          </div>
        </section>

        <section aria-labelledby="how-title" className="py-12 sm:py-16">
          <div className="page-container space-y-8 lg:px-10">
            <div className="space-y-2">
              <p className="section-eyebrow">Comment ça marche</p>
              <h2 id="how-title" className="section-title">
                De votre inspiration à votre création
              </h2>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <li key={title} className="space-y-3 rounded-[22px] border bg-card p-5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="text-base">
                    <span className="text-muted-foreground">{index + 1}. </span>
                    {title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="demande" aria-labelledby="request-title" className="scroll-mt-24 bg-muted/50 py-12 sm:py-16">
          <div className="page-container max-w-4xl space-y-8 lg:px-10">
            <div className="space-y-2">
              <p className="section-eyebrow">Votre projet</p>
              <h2 id="request-title" className="section-title">
                Décrivez-nous votre idée
              </h2>
              <p className="text-sm text-muted-foreground">Six courtes étapes. Seuls votre nom, votre téléphone, la nature et la description du projet sont indispensables.</p>
            </div>
            <CustomRequestFormSection />
          </div>
        </section>
      </main>

      <SiteFooter />
      <WhatsAppButton />
    </>
  );
}
