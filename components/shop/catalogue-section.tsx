'use client';

import { Heart, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CatalogueEmpty, CatalogueError, ProductGridSkeleton } from '@/components/shop/catalogue-states';
import { ProductCard } from '@/components/shop/product-card';
import {
  SORT_LABELS,
  type Category,
  type CategoryFilter,
  type Product,
  type SortKey,
} from '@/lib/products';
import { cn } from '@/lib/utils';

export type CatalogueStatus =
  | { status: 'loading' }
  | { status: 'error'; kind: 'config' | 'network'; onRetry: () => void }
  | { status: 'ready' };

interface CatalogueSectionProps {
  catalogue: CatalogueStatus;
  /** Produits après recherche, filtre et tri. */
  products: Product[];
  /** Nombre total de produits publiés (avant filtres). */
  catalogueSize: number;
  categories: Category[];
  query: string;
  category: CategoryFilter;
  sort: SortKey;
  favoriteIds: string[];
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: CategoryFilter) => void;
  onSortChange: (sort: SortKey) => void;
  onReset: () => void;
  onToggleFavorite: (productId: string) => void;
  onAdd: (productId: string) => void;
  onOpen: (productId: string) => void;
}

const chip =
  'inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors';

export function CatalogueSection({
  catalogue,
  products,
  catalogueSize,
  categories,
  query,
  category,
  sort,
  favoriteIds,
  onQueryChange,
  onCategoryChange,
  onSortChange,
  onReset,
  onToggleFavorite,
  onAdd,
  onOpen,
}: CatalogueSectionProps) {
  const filtersActive = query.trim() !== '' || category !== 'all';
  const chips: { id: CategoryFilter; label: string }[] = [
    { id: 'all', label: 'Tous' },
    ...categories.map((item) => ({ id: item.id as CategoryFilter, label: item.name })),
  ];
  const categoryNames = new Map(categories.map((item) => [item.id, item.name]));

  const heading = (
    <div className="space-y-2">
      <p className="section-eyebrow">La sélection du moment</p>
      <h2 className="section-title">Notre catalogue</h2>
    </div>
  );

  if (catalogue.status !== 'ready' || catalogueSize === 0) {
    return (
      <section id="catalogue" className="scroll-mt-24 py-12 sm:py-16">
        <div className="page-container space-y-8">
          {heading}
          {catalogue.status === 'loading' && <ProductGridSkeleton />}
          {catalogue.status === 'error' && <CatalogueError kind={catalogue.kind} onRetry={catalogue.onRetry} />}
          {catalogue.status === 'ready' && <CatalogueEmpty />}
        </div>
      </section>
    );
  }

  return (
    <section id="catalogue" className="scroll-mt-24 py-12 sm:py-16">
      <div className="page-container space-y-8">
        {heading}

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="catalogue-search" className="sr-only">
              Rechercher un meuble ou une décoration
            </label>
            <Input
              id="catalogue-search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Rechercher un meuble, une décoration…"
              className="h-12 pl-10"
              autoComplete="off"
            />
          </div>
          <div className="sm:w-56">
            <label htmlFor="catalogue-sort" className="sr-only">
              Trier les produits
            </label>
            <select
              id="catalogue-sort"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SortKey)}
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  Tri : {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div role="group" aria-label="Filtrer par catégorie" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {chips.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => onCategoryChange(item.id)}
              className={cn(
                chip,
                category === item.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card hover:bg-accent'
              )}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={category === 'favorites'}
            onClick={() => onCategoryChange('favorites')}
            className={cn(
              chip,
              category === 'favorites'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-accent'
            )}
          >
            <Heart className="h-4 w-4" aria-hidden />
            Favoris{favoriteIds.length > 0 ? ` (${favoriteIds.length})` : ''}
          </button>
        </div>

        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {products.length} produit{products.length > 1 ? 's' : ''}
        </p>

        {products.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                categoryName={product.categoryId ? categoryNames.get(product.categoryId) : undefined}
                favorite={favoriteIds.includes(product.id)}
                onToggleFavorite={onToggleFavorite}
                onAdd={onAdd}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-14 text-center">
            <Search className="h-7 w-7 text-muted-foreground" aria-hidden />
            <h3 className="text-xl font-semibold">
              {category === 'favorites' && query.trim() === '' ? 'Aucun favori pour le moment' : 'Aucun produit trouvé'}
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {category === 'favorites' && query.trim() === ''
                ? 'Touchez le cœur d’un produit pour le retrouver ici.'
                : 'Essayez une autre recherche ou une autre catégorie.'}
            </p>
            {filtersActive && (
              <Button type="button" variant="outline" onClick={onReset}>
                <X className="mr-2 h-4 w-4" aria-hidden />
                Réinitialiser les filtres
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
