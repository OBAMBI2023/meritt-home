import { cn } from '@/lib/utils';
import { SITE } from '@/lib/site';

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-start leading-none text-foreground', className)}>
      <span className="sr-only">{SITE.name}</span>
      <span aria-hidden className="text-xl font-extrabold tracking-[0.14em] sm:text-[1.375rem]">
        MERITT
      </span>
      <span aria-hidden className="mt-1 text-[9px] font-medium tracking-[0.5em] text-muted-foreground">
        HOME
      </span>
    </span>
  );
}
