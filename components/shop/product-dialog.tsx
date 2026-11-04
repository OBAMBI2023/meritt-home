'use client';

import { Heart, MessageCircle, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AvailabilityNote } from '@/components/shop/availability-note';
import { ProductImage } from '@/components/shop/product-image';
import { formatPrice, getAvailability, type Product } from '@/lib/products';
import { SITE, whatsappLink } from '@/lib/site';
import { cn } from '@/lib/utils';

interface ProductDialogProps {
  product: Product | null;
  categoryName?: string;
  favorite: boolean;
  onClose: () => void;
  onToggleFavorite: (productId: string) => void;
  onAdd: (productId: string) => void;
}

export function ProductDialog({ product, categoryName, favorite, onClose, onToggleFavorite, onAdd }: ProductDialogProps) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] max-w-3xl gap-0 overflow-y-auto p-0 sm:rounded-xl">
        {product && (
          <div className="grid md:grid-cols-2">
            <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[26rem]">
              <ProductImage src={product.image} alt={product.name} sizes="(min-width: 768px) 384px, 100vw" />
            </div>
            <div className="flex flex-col gap-5 p-6 sm:p-8">
              <div className="space-y-2">
                {categoryName && <p className="section-eyebrow">{categoryName}</p>}
                <DialogTitle className="font-display text-3xl font-semibold leading-tight">{product.name}</DialogTitle>
                <p className="text-2xl font-semibold text-primary">{formatPrice(product.price)}</p>
                <AvailabilityNote product={product} />
              </div>

              <DialogDescription className="text-sm leading-relaxed">
                {product.description ||
                  'Les caractéristiques détaillées de ce produit (dimensions, matières, coloris) seront ajoutées prochainement. Pour toute question, contactez-nous.'}
              </DialogDescription>

              <div className="mt-auto flex flex-col gap-3">
                <Button
                  type="button"
                  size="lg"
                  className="h-12"
                  disabled={getAvailability(product)?.purchasable === false}
                  onClick={() => {
                    onAdd(product.id);
                    onClose();
                  }}
                >
                  <ShoppingBag className="mr-2 h-4 w-4" aria-hidden />
                  {getAvailability(product)?.purchasable === false ? getAvailability(product)?.label : 'Ajouter au panier'}
                </Button>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={favorite}
                    onClick={() => onToggleFavorite(product.id)}
                  >
                    <Heart className={cn('mr-2 h-4 w-4', favorite && 'fill-destructive text-destructive')} aria-hidden />
                    {favorite ? 'Dans vos favoris' : 'Ajouter aux favoris'}
                  </Button>
                  <Button asChild variant="outline">
                    <a
                      href={whatsappLink(`Bonjour ${SITE.name}, je souhaite des informations sur : ${product.name}.`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                      Question
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
