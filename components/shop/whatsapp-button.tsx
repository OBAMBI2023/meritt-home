import { MessageCircle } from 'lucide-react';
import { SITE, whatsappLink } from '@/lib/site';

export function WhatsAppButton() {
  return (
    <a
      href={whatsappLink(`Bonjour ${SITE.name}, je souhaite avoir plus d'informations.`)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Contacter ${SITE.name} sur WhatsApp au ${SITE.whatsappDisplay}`}
      className="fixed bottom-20 right-4 z-30 flex h-12 items-center gap-3 rounded-full bg-primary px-4 text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] motion-reduce:transition-none md:bottom-6 md:right-6"
    >
      <MessageCircle className="h-5 w-5" aria-hidden />
      <span className="hidden text-sm font-semibold md:inline">Besoin d’aide ?</span>
    </a>
  );
}
