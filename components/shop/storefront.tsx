'use client';

import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { BottomNav, type BottomNavItem } from '@/components/shop/bottom-nav';
import { CartSheet } from '@/components/shop/cart-sheet';
import { CatalogueSection, type CatalogueStatus } from '@/components/shop/catalogue-section';
import { CategoriesSection } from '@/components/shop/categories-section';
import { ChristmasBanner } from '@/components/shop/christmas-banner';
import { CollectionsSection } from '@/components/shop/collections-section';
import { PromoBanner } from '@/components/shop/promo-banner';
import { CheckoutDialog } from '@/components/shop/checkout-dialog';
import { HeroSection } from '@/components/shop/hero-section';
import { ProductDialog } from '@/components/shop/product-dialog';
import { SiteFooter } from '@/components/shop/site-footer';
import { SiteHeader } from '@/components/shop/site-header';
import { WhatsAppButton } from '@/components/shop/whatsapp-button';
import { useBannersState } from '@/hooks/use-banners';
import { useCart } from '@/hooks/use-cart';
import { useCatalogue } from '@/hooks/use-catalogue';
import { useFavorites } from '@/hooks/use-favorites';
import {
  countByCategory,
  getCategory,
  queryProducts,
  type Category,
  type CategoryFilter,
  type Product,
  type SortKey,
} from '@/lib/products';

const NO_PRODUCTS: Product[] = [];
const NO_CATEGORIES: Category[] = [];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView();
}

export function Storefront() {
  const { state: catalogueState, reload } = useCatalogue();
  const ready = catalogueState.status === 'ready';
  const products = catalogueState.status === 'ready' ? catalogueState.products : NO_PRODUCTS;
  const allCategories = catalogueState.status === 'ready' ? catalogueState.categories : NO_CATEGORIES;

  // Les catégories sans produit publié ne sont pas proposées aux visiteurs.
  const categories = useMemo(
    () => allCategories.filter((category) => countByCategory(products, category.id) > 0),
    [allCategories, products]
  );

  const { banners, confirmed: bannersConfirmed } = useBannersState();
  const cart = useCart(products);
  const favorites = useFavorites();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sort, setSort] = useState<SortKey>('default');
  const [navActive, setNavActive] = useState<BottomNavItem>('home');

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [openedProductId, setOpenedProductId] = useState<string | null>(null);

  // Une fois un catalogue non vide chargé, on retire du panier et des favoris les produits qui n'existent plus.
  const { hydrated: cartHydrated, pruneUnavailable: pruneCart } = cart;
  const { hydrated: favoritesHydrated, pruneUnavailable: pruneFavorites } = favorites;
  useEffect(() => {
    if (!ready || products.length === 0) return;
    if (cartHydrated) {
      const removed = pruneCart(products);
      if (removed > 0) {
        toast.info(
          removed === 1
            ? 'Un article n’est plus disponible et a été retiré de votre panier.'
            : `${removed} articles ne sont plus disponibles et ont été retirés de votre panier.`
        );
      }
    }
    if (favoritesHydrated) pruneFavorites(products);
  }, [ready, products, cartHydrated, pruneCart, favoritesHydrated, pruneFavorites]);

  const visibleProducts = useMemo(
    () => queryProducts(products, categories, { query, category, sort, favoriteIds: favorites.ids }),
    [products, categories, query, category, sort, favorites.ids]
  );

  const openedProduct = products.find((product) => product.id === openedProductId) ?? null;

  const catalogueStatus: CatalogueStatus =
    catalogueState.status === 'error'
      ? { status: 'error', kind: catalogueState.kind, onRetry: reload }
      : { status: catalogueState.status };

  const addToCart = (productId: string) => {
    cart.add(productId);
    const product = products.find((item) => item.id === productId);
    if (product) toast.success(`${product.name} ajouté au panier`);
  };

  const showCategory = (next: CategoryFilter) => {
    setCategory(next);
    setNavActive(next === 'favorites' ? 'favorites' : 'catalogue');
  };

  const selectCategory = (categoryId: string) => {
    showCategory(categoryId);
    scrollToId('catalogue');
  };

  const showFavorites = () => {
    showCategory('favorites');
    scrollToId('catalogue');
  };

  const resetFilters = () => {
    setQuery('');
    setCategory('all');
  };

  const navigate = (item: BottomNavItem) => {
    setNavActive(item);
    if (item === 'home') window.scrollTo({ top: 0 });
    else if (item === 'favorites') showFavorites();
    else {
      setCategory((current) => (current === 'favorites' ? 'all' : current));
      scrollToId('catalogue');
    }
  };

  const startCheckout = () => {
    setCartOpen(false);
    setCheckoutOpen(true);
  };

  const cartCount = cart.hydrated ? cart.count : 0;
  const favoriteCount = favorites.hydrated ? favorites.ids.filter((id) => products.some((product) => product.id === id)).length : 0;

  return (
    <>
      <SiteHeader
        showCategories={catalogueState.status === 'loading' || categories.length > 0}
        cartCount={cartCount}
        favoriteCount={favoriteCount}
        onOpenCart={() => setCartOpen(true)}
        onOpenFavorites={showFavorites}
      />

      <main className="pb-16 md:pb-0">
        <HeroSection hero={banners.hero} />
        <ChristmasBanner christmas={bannersConfirmed ? banners.christmas : null} />
        <CategoriesSection
          loading={catalogueState.status === 'loading'}
          categories={categories}
          products={products}
          onSelect={selectCategory}
        />
        <CatalogueSection
          catalogue={catalogueStatus}
          products={visibleProducts}
          catalogueSize={products.length}
          categories={categories}
          query={query}
          category={category}
          sort={sort}
          favoriteIds={favorites.ids}
          onQueryChange={setQuery}
          onCategoryChange={showCategory}
          onSortChange={setSort}
          onReset={resetFilters}
          onToggleFavorite={favorites.toggle}
          onAdd={addToCart}
          onOpen={setOpenedProductId}
        />
        <PromoBanner promo={banners.promo} />
        <CollectionsSection images={banners.collections} />
      </main>

      <div className="pb-16 md:pb-0">
        <SiteFooter />
      </div>

      <BottomNav
        active={navActive}
        cartCount={cartCount}
        favoriteCount={favoriteCount}
        onNavigate={navigate}
        onOpenCart={() => setCartOpen(true)}
      />
      <WhatsAppButton />

      <ProductDialog
        product={openedProduct}
        categoryName={openedProduct ? getCategory(allCategories, openedProduct.categoryId)?.name : undefined}
        favorite={openedProduct ? favorites.ids.includes(openedProduct.id) : false}
        onClose={() => setOpenedProductId(null)}
        onToggleFavorite={favorites.toggle}
        onAdd={addToCart}
      />
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        lines={cart.details}
        categories={allCategories}
        totals={cart.totals}
        count={cart.count}
        onUpdate={cart.update}
        onRemove={cart.remove}
        onCheckout={startCheckout}
      />
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        lines={cart.details}
        totals={cart.totals}
        onClearCart={cart.clear}
      />

      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
