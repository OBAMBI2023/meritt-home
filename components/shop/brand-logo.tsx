import { cn } from '@/lib/utils';
import { Logo } from '@/components/shop/logo';

/** Logo de marque horizontal (boutique, administration, factures, reçus). */
export function BrandLogo({ className }: { className?: string }) {
  return <Logo variant="horizontal" className={cn('text-foreground', className)} />;
}
