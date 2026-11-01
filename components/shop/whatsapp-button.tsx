import { MessageCircle } from 'lucide-react';
import { SITE, whatsappLink } from '@/lib/site';

export function WhatsAppButton() {
  return (
    <a
      href={whatsappLink(`Bonjour ${SITE.name}, je souhaite avoir plus d'informations.`)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Contacter ${SITE.name} sur WhatsApp au ${SITE.whatsappDisplay}`}
      className="fixed bottom-20 right-3 z-30 flex items-center gap-3 rounded-[15px] bg-[#1d9b64] px-3.5 py-2.5 text-white shadow-[0_10px_30px_rgba(29,155,100,0.4)] transition-all hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-[0_14px_36px_rgba(29,155,100,0.5)] motion-reduce:transition-none md:bottom-6 md:right-[22px] md:px-[18px] md:py-3"
    >
      <MessageCircle className="h-6 w-6 shrink-0" aria-hidden />
      <span className="flex flex-col leading-tight">
        <span className="text-[13px] font-bold md:text-sm">Besoin d’aide ?</span>
        <span className="hidden text-xs opacity-90 md:block">{SITE.whatsappDisplay}</span>
      </span>
    </a>
  );
}
