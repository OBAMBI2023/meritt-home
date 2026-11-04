import { Clock, PackageCheck, PackageX } from 'lucide-react';
import { getAvailability, type Product } from '@/lib/products';
import { cn } from '@/lib/utils';

/**
 * Mention de disponibilité d'un produit : « En stock », « Épuisé », « Disponible sur commande » ou « Indisponible ».
 * Elle découle uniquement des données réelles (voir getAvailability) ; sans données de stock hybride, rien n'est affiché.
 * Le délai d'approvisionnement n'apparaît que s'il est renseigné.
 */
export function AvailabilityNote({ product, className }: { product: Pick<Product, 'availability'>; className?: string }) {
  const availability = getAvailability(product);
  if (!availability) return null;
  const Icon = availability.kind === 'in_stock' ? PackageCheck : availability.kind === 'on_demand' ? Clock : PackageX;
  return (
    <div className={cn('space-y-0.5 text-sm', className)}>
      <p
        className={cn(
          'inline-flex items-center gap-1.5 font-medium',
          availability.kind === 'in_stock' && 'text-success',
          availability.kind === 'on_demand' && 'text-foreground',
          (availability.kind === 'sold_out' || availability.kind === 'unavailable') && 'text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {availability.label}
      </p>
      {availability.leadTime && <p className="pl-[1.375rem] text-xs text-muted-foreground">Délai indicatif : {availability.leadTime}</p>}
    </div>
  );
}
