'use client';

import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ProductImage } from '@/components/shop/product-image';
import { MAX_QUANTITY, type DetailedCartLine } from '@/lib/cart';
import { DELIVERY } from '@/lib/site';
import { formatPrice, getCategory, type Category } from '@/lib/products';

interface CartSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: DetailedCartLine[];
  categories: Category[];
  totals: { subtotal: number; delivery: number; total: number };
  count: number;
  onUpdate: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
}

export function CartSheet({ open, onOpenChange, lines, categories, totals, count, onUpdate, onRemove, onCheckout }: CartSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle className="font-display text-2xl">Mon panier</SheetTitle>
          <SheetDescription>
            {count === 0 ? 'Aucun article' : `${count} article${count > 1 ? 's' : ''}`}
          </SheetDescription>
        </SheetHeader>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <ShoppingBag className="h-9 w-9 text-muted-foreground" aria-hidden />
            <h3 className="text-xl font-semibold">Votre panier est vide</h3>
            <p className="text-sm text-muted-foreground">Ajoutez une pièce qui vous ressemble.</p>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Découvrir le catalogue
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y overflow-y-auto px-5">
              {lines.map(({ product, quantity, lineTotal }) => (
                <li key={product.id} className="flex gap-4 py-4">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md">
                    <ProductImage src={product.image} alt={product.name} sizes="96px" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div>
                      <p className="font-semibold leading-snug">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{getCategory(categories, product.categoryId)?.name}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{formatPrice(product.price)} l’unité</p>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-md border" role="group" aria-label={`Quantité de ${product.name}`}>
                        <button
                          type="button"
                          className="flex h-10 w-10 items-center justify-center rounded-l-md hover:bg-accent disabled:opacity-40"
                          onClick={() => onUpdate(product.id, quantity - 1)}
                          disabled={quantity <= 1}
                          aria-label={`Diminuer la quantité de ${product.name}`}
                        >
                          <Minus className="h-4 w-4" aria-hidden />
                        </button>
                        <span className="w-8 text-center text-sm font-medium" aria-live="polite">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          className="flex h-10 w-10 items-center justify-center rounded-r-md hover:bg-accent disabled:opacity-40"
                          onClick={() => onUpdate(product.id, quantity + 1)}
                          disabled={quantity >= MAX_QUANTITY}
                          aria-label={`Augmenter la quantité de ${product.name}`}
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <p className="font-semibold">{formatPrice(lineTotal)}</p>
                      <button
                        type="button"
                        onClick={() => onRemove(product.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                        aria-label={`Retirer ${product.name} du panier`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="space-y-4 border-t bg-card p-5">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Sous-total</dt>
                  <dd className="font-medium">{formatPrice(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Livraison à {DELIVERY.zone} (indicatif)</dt>
                  <dd className="font-medium">{formatPrice(totals.delivery)}</dd>
                </div>
                <div className="flex justify-between border-t pt-3 text-base">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-semibold text-primary">{formatPrice(totals.total)}</dd>
                </div>
              </dl>
              <Button type="button" size="lg" className="h-12 w-full" onClick={onCheckout}>
                Passer la commande
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
