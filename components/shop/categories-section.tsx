'use client';

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
    <section id="categories" className="scroll-mt-24 py-10 sm:py-16">
      <div className="page-container space-y-7 lg:px-10">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="section-eyebrow">Trouvez votre style</p>
            <h2 className="section-title">Explorer par catégorie</h2>
          </div>
          <a href="#catalogue" className="shrink-0 font-semibold text-ring hover:underline">
            Voir tout
          </a>
        </div>

        {loading ? (
          <CategoriesSkeleton />
        ) : (
          <ul className="-mx-4 flex gap-3.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
            {categories.map((category) => {
              const count = countByCategory(products, category.id);
              return (
                <li key={category.id} className="w-[150px] shrink-0 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => onSelect(category.id)}
                    className="group relative block aspect-[3/4] w-full overflow-hidden rounded-[22px] text-left"
                  >
                    <ProductImage
                      src={categoryImage(products, category.id)}
                      alt=""
                      sizes="(min-width: 1024px) 20vw, 50vw"
                      className="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                    />
                    <span className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/60 to-transparent px-[18px] pb-[18px] pt-10 text-white">
                      <span className="font-bold">{category.name}</span>
                      <span className="text-xs opacity-85">
                        {count} produit{count > 1 ? 's' : ''}
                      </span>
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
