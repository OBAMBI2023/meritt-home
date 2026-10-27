import { cn } from '@/lib/utils';
import { SITE } from '@/lib/site';

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-2 whitespace-nowrap text-primary', className)}>
      <span className="sr-only">{SITE.name}</span>
      <span aria-hidden className="font-display text-xl font-bold tracking-[0.16em] sm:text-2xl">
        MERITT
      </span>
      <span aria-hidden className="text-[10px] font-medium tracking-[0.32em]">
        HOME
      </span>
    </span>
  );
}
