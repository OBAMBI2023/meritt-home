import { AlertTriangle, PackageOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** État de chargement : squelettes à la place de la grille de produits. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement du catalogue…</span>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-lg border bg-card">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CategoriesSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement des catégories…</span>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="overflow-hidden rounded-lg border bg-card">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-3 sm:p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CatalogueErrorProps {
  kind: 'config' | 'network';
  onRetry: () => void;
}

/** État d'erreur : message compréhensible et nouvelle tentative. */
export function CatalogueError({ kind, onRetry }: CatalogueErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <AlertTriangle className="h-8 w-8 text-warning" aria-hidden />
      <h3 className="text-xl font-semibold">Le catalogue est momentanément indisponible</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        {kind === 'config'
          ? 'La connexion au catalogue n’est pas configurée. Réessayez dans un instant ou contactez-nous.'
          : 'Nous n’avons pas pu charger les produits. Vérifiez votre connexion internet, puis réessayez.'}
      </p>
      <Button type="button" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
        Réessayer
      </Button>
    </div>
  );
}

/** État vide : aucun produit publié. */
export function CatalogueEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <PackageOpen className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h3 className="text-xl font-semibold">Le catalogue sera bientôt disponible</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        Nos premières pièces arrivent prochainement. Pour toute question, contactez-nous sur WhatsApp.
      </p>
    </div>
  );
}
