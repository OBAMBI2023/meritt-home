'use client';

import { Heart, Home, LayoutGrid, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BottomNavItem = 'home' | 'catalogue' | 'favorites';

interface BottomNavProps {
  active: BottomNavItem;
  cartCount: number;
  favoriteCount: number;
  onNavigate: (item: BottomNavItem) => void;
  onOpenCart: () => void;
}

const itemClass = 'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors';

export function BottomNav({ active, cartCount, favoriteCount, onNavigate, onOpenCart }: BottomNavProps) {
  const items: { id: BottomNavItem; label: string; icon: typeof Home; count: number }[] = [
    { id: 'home', label: 'Accueil', icon: Home, count: 0 },
    { id: 'catalogue', label: 'Catalogue', icon: LayoutGrid, count: 0 },
    { id: 'favorites', label: 'Favoris', icon: Heart, count: favoriteCount },
  ];

  return (
    <nav
      aria-label="Navigation mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="flex">
        {items.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={active === id ? 'page' : undefined}
            className={cn(itemClass, active === id ? 'text-primary' : 'text-muted-foreground')}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden />
              {count > 0 && (
                <span aria-hidden className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                  {count}
                </span>
              )}
            </span>
            {label}
            {count > 0 && <span className="sr-only">, {count}</span>}
          </button>
        ))}
        <button type="button" onClick={onOpenCart} className={cn(itemClass, 'text-muted-foreground')}>
          <span className="relative">
            <ShoppingBag className="h-5 w-5" aria-hidden />
            {cartCount > 0 && (
              <span aria-hidden className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                {cartCount}
              </span>
            )}
          </span>
          Panier
          {cartCount > 0 && <span className="sr-only">, {cartCount} article{cartCount > 1 ? 's' : ''}</span>}
        </button>
      </div>
    </nav>
  );
}
