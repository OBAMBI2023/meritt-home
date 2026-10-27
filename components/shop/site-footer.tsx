'use client';

import { MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/shop/brand-logo';
import { SITE, whatsappLink } from '@/lib/site';

export function SiteFooter({ onOpenAdminPreview }: { onOpenAdminPreview: () => void }) {
  return (
    <footer id="contact" className="scroll-mt-24 border-t bg-card">
      <div className="page-container grid gap-10 py-12 md:grid-cols-2">
        <div className="space-y-4">
          <BrandLogo />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Des intérieurs qui ont une âme, sélectionnés avec passion en Côte d’Ivoire.
          </p>
        </div>

        <div className="space-y-4">
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wider">Nous contacter</h2>
          <ul className="space-y-3 text-sm">
            <li>
              <a
                href={whatsappLink(`Bonjour ${SITE.name}, je souhaite avoir plus d'informations.`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 hover:text-primary hover:underline"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                WhatsApp : {SITE.whatsappDisplay}
              </a>
            </li>
            <li className="inline-flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden />
              {SITE.location}
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t">
        <div className="page-container flex flex-col items-start justify-between gap-3 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {SITE.name} · {SITE.location}</p>
          <button
            type="button"
            onClick={onOpenAdminPreview}
            className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:text-foreground hover:underline"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Aperçu de l’interface d’administration (prototype)
          </button>
        </div>
      </div>
    </footer>
  );
}
