'use client';

import { ArrowRight } from 'lucide-react';
import { CategoriesSkeleton } from '@/components/shop/catalogue-states';
import { ProductImage } from '@/components/shop/product-image';
import { categoryImage, countByCategory, type Category, type Product } from '@/lib/products';

interface CategoriesSectionProps {
  loading: boolean;
  categories: Category[];
  products: Product[];
  onSelect: (categoryId: string) => void;
}

/** N'est affichée que pendant le chargement ou s'il existe au moins une catégorie contenant des produits. */
export function CategoriesSection({ loading, categories, products, onSelect }: CategoriesSectionProps) {
  if (!loading && categories.length === 0) return null;

  return (
    <section id="categories" className="scroll-mt-24 border-y bg-muted/50 py-12 sm:py-16">
      <div className="page-container space-y-8">
        <div className="space-y-2">
          <p className="section-eyebrow">Trouvez votre style</p>
          <h2 className="section-title">Explorer par catégorie</h2>
        </div>

        {loading ? (
          <CategoriesSkeleton />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            {categories.map((category) => {
              const count = countByCategory(products, category.id);
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(category.id)}
                    className="group block w-full overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-md"
                  >
                    <span className="relative block aspect-[4/3] overflow-hidden">
                      <ProductImage
                        src={categoryImage(products, category.id)}
                        alt=""
                        sizes="(min-width: 1024px) 20vw, 50vw"
                        className="transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                      />
                    </span>
                    <span className="flex items-center justify-between gap-2 p-3 sm:p-4">
                      <span>
                        <span className="block font-semibold">{category.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {count} produit{count > 1 ? 's' : ''}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
