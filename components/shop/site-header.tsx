'use client';

import { Heart, ShoppingBag } from 'lucide-react';
import { BrandLogo } from '@/components/shop/brand-logo';

const LINKS = [
  { href: '#accueil', label: 'Accueil' },
  { href: '#categories', label: 'Catégories', needsCategories: true },
  { href: '#catalogue', label: 'Catalogue' },
  { href: '#inspirations', label: 'Inspirations' },
  { href: '#contact', label: 'À propos' },
];

interface SiteHeaderProps {
  /** Masque le lien « Catégories » quand la section n'est pas affichée. */
  showCategories: boolean;
  cartCount: number;
  favoriteCount: number;
  onOpenCart: () => void;
  onOpenFavorites: () => void;
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground"
    >
      {count}
    </span>
  );
}

const iconButton =
  'relative flex h-11 w-11 items-center justify-center rounded-[13px] text-foreground transition-colors hover:bg-muted';

export function SiteHeader({ showCategories, cartCount, favoriteCount, onOpenCart, onOpenFavorites }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="page-container flex h-[68px] items-center justify-between gap-4 sm:h-[84px] lg:px-10">
        <a href="#accueil" className="rounded-md" aria-label="Meritt Home, retour à l'accueil">
          <BrandLogo />
        </a>

        <nav aria-label="Navigation principale" className="hidden items-center gap-9 md:flex">
          {LINKS.filter((link) => showCategories || !link.needsCategories).map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              className={
                index === 0
                  ? 'text-sm font-semibold text-ring'
                  : 'text-sm font-medium text-muted-foreground transition-colors hover:text-ring'
              }
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenFavorites}
            className={iconButton}
            aria-label={favoriteCount > 0 ? `Favoris, ${favoriteCount} produit${favoriteCount > 1 ? 's' : ''}` : 'Favoris'}
          >
            <Heart className="h-5 w-5" aria-hidden />
            <CountBadge count={favoriteCount} />
          </button>
          <button
            type="button"
            onClick={onOpenCart}
            className={iconButton}
            aria-label={cartCount > 0 ? `Panier, ${cartCount} article${cartCount > 1 ? 's' : ''}` : 'Panier'}
          >
            <ShoppingBag className="h-5 w-5" aria-hidden />
            <CountBadge count={cartCount} />
          </button>
        </div>
      </div>
    </header>
  );
}
