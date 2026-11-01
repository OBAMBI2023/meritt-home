/**
 * Types et fonctions pures du catalogue Meritt Home.
 * Les données viennent de Supabase (voir lib/catalogue.ts) : aucun produit n'est codé en dur.
 */

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export interface Product {
  /** UUID du produit dans Supabase. */
  id: string;
  slug: string;
  name: string;
  categoryId: string | null;
  /** Prix en FCFA (entier), colonne `price_fcfa`. */
  price: number;
  /** Première image du produit (colonne `image_urls`), si elle est exploitable. */
  image: string | null;
  description: string | null;
}

export function formatPrice(price: number): string {
  return `${price.toLocaleString('fr-FR')} FCFA`;
}

export function getCategory(categories: Category[], id: string | null): Category | undefined {
  return id ? categories.find((category) => category.id === id) : undefined;
}

export function countByCategory(products: Product[], categoryId: string): number {
  return products.filter((product) => product.categoryId === categoryId).length;
}

/** Image d'illustration d'une catégorie : celle de son premier produit disposant d'une image. */
export function categoryImage(products: Product[], categoryId: string): string | null {
  return products.find((product) => product.categoryId === categoryId && product.image)?.image ?? null;
}

/* ------------------------------------------------------------------ */
/* Recherche, filtre et tri                                            */
/* ------------------------------------------------------------------ */

/** 'all', 'favorites' ou l'identifiant (UUID) d'une catégorie. */
export type CategoryFilter = 'all' | 'favorites' | (string & {});
export type SortKey = 'default' | 'price-asc' | 'price-desc' | 'name';

export const SORT_LABELS: Record<SortKey, string> = {
  default: 'Sélection',
  'price-asc': 'Prix croissant',
  'price-desc': 'Prix décroissant',
  name: 'Nom (A–Z)',
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

export interface CatalogueQuery {
  query: string;
  category: CategoryFilter;
  sort: SortKey;
  favoriteIds: string[];
}

export function queryProducts(
  products: Product[],
  categories: Category[],
  { query, category, sort, favoriteIds }: CatalogueQuery
): Product[] {
  const needle = normalize(query);
  const result = products.filter((product) => {
    if (category === 'favorites' && !favoriteIds.includes(product.id)) return false;
    if (category !== 'all' && category !== 'favorites' && product.categoryId !== category) return false;
    if (!needle) return true;
    const categoryName = getCategory(categories, product.categoryId)?.name ?? '';
    return normalize(`${product.name} ${categoryName}`).includes(needle);
  });

  switch (sort) {
    case 'price-asc':
      return [...result].sort((a, b) => a.price - b.price);
    case 'price-desc':
      return [...result].sort((a, b) => b.price - a.price);
    case 'name':
      return [...result].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    default:
      return result;
  }
}
