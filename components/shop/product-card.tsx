'use client';

import { Heart } from 'lucide-react';
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
    <article className="group relative flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => onToggleFavorite(product.id)}
        aria-pressed={favorite}
        aria-label={favorite ? `Retirer ${product.name} des favoris` : `Ajouter ${product.name} aux favoris`}
        className="absolute right-2.5 top-2.5 z-10 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-background text-foreground shadow-sm transition-colors hover:bg-background"
      >
        <Heart className={cn('h-[18px] w-[18px]', favorite && 'fill-destructive text-destructive')} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => onOpen(product.id)}
        aria-label={`Voir la fiche de ${product.name}`}
        className="relative mb-2 block aspect-square w-full overflow-hidden rounded-[22px] bg-muted"
      >
        <ProductImage
          src={product.image}
          alt={`${product.name}${categoryName ? `, ${categoryName}` : ''}`}
          className="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
        />
      </button>

      {categoryName && <p className="text-[13px] text-muted-foreground">{categoryName}</p>}
      <h3 className="text-base font-semibold leading-snug tracking-normal sm:text-[1.0625rem]">
        <button type="button" onClick={() => onOpen(product.id)} className="text-left hover:underline">
          {product.name}
        </button>
      </h3>
      <p className="mb-2 text-base font-bold">{formatPrice(product.price)}</p>
      <button
        type="button"
        onClick={() => onAdd(product.id)}
        className="mt-auto w-full rounded-[13px] bg-muted py-3 text-sm font-semibold transition-colors hover:bg-accent"
      >
        Ajouter au panier
      </button>
    </article>
  );
}
