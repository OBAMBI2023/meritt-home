import Link from 'next/link';
import { MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/shop/brand-logo';
import { CUSTOM, CUSTOM_PATH, HIDE_CUSTOM_MODULE, SITE, whatsappLink } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer id="contact" className="mt-10 scroll-mt-24 bg-muted sm:mt-16">
      <div className="page-container flex flex-col items-center gap-4 py-12 text-center">
        <BrandLogo className="h-8" />
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Des intérieurs qui ont une âme, sélectionnés avec passion en Côte d’Ivoire.
        </p>
        <ul className="flex flex-col items-center gap-1 text-sm sm:flex-row sm:gap-6">
          <li>
            <a
              href={whatsappLink(`Bonjour ${SITE.name}, je souhaite avoir plus d'informations.`)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[2.75rem] items-center gap-2 hover:text-ring hover:underline"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              WhatsApp : {SITE.whatsappDisplay}
            </a>
          </li>
          {!HIDE_CUSTOM_MODULE && (
            <li>
              <Link href={CUSTOM_PATH} className="inline-flex min-h-[2.75rem] items-center gap-2 hover:text-ring hover:underline">
                {CUSTOM.name}
              </Link>
            </li>
          )}
          <li className="inline-flex min-h-[2.75rem] items-center gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4" aria-hidden />
            {SITE.location}
          </li>
        </ul>
        <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} {SITE.name} · {SITE.location}</p>
          <Link
            href="/admin"
            className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-sm underline-offset-4 hover:text-foreground hover:underline"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Administration
          </Link>
        </div>
      </div>
    </footer>
  );
}
