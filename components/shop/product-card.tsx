'use client';

import { Heart, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImage } from '@/components/shop/product-image';
import { formatPrice, type Product } from '@/lib/products';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: Product;
  categoryName?: string;
  favorite: boolean;
  onToggleFavorite: (productId: string) => void;
  onAdd: (productId: string) => void;
  onOpen: (productId: string) => void;
}

export function ProductCard({ product, categoryName, favorite, onToggleFavorite, onAdd, onOpen }: ProductCardProps) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => onToggleFavorite(product.id)}
        aria-pressed={favorite}
        aria-label={favorite ? `Retirer ${product.name} des favoris` : `Ajouter ${product.name} aux favoris`}
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background"
      >
        <Heart className={cn('h-[18px] w-[18px]', favorite && 'fill-destructive text-destructive')} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => onOpen(product.id)}
        aria-label={`Voir la fiche de ${product.name}`}
        className="relative block aspect-[4/3] w-full overflow-hidden"
      >
        <ProductImage
          src={product.image}
          alt={`${product.name}${categoryName ? `, ${categoryName}` : ''}`}
          className="transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      </button>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          {categoryName && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{categoryName}</p>}
          <h3 className="text-lg font-semibold leading-snug">
            <button type="button" onClick={() => onOpen(product.id)} className="text-left hover:underline">
              {product.name}
            </button>
          </h3>
          <p className="text-base font-semibold text-primary">{formatPrice(product.price)}</p>
        </div>
        <Button type="button" className="mt-auto w-full" onClick={() => onAdd(product.id)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Ajouter au panier
        </Button>
      </div>
    </article>
  );
}
