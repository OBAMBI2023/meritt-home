import { ProductImage } from '@/components/shop/product-image';
import type { Banners } from '@/lib/banners';
import { COLLECTIONS } from '@/lib/site';

export function CollectionsSection({ images }: { images: Banners['collections'] }) {
  return (
    <section id="inspirations" className="scroll-mt-24 py-10 sm:py-16">
      <div className="page-container space-y-7 lg:px-10">
        <div className="space-y-2">
          <p className="section-eyebrow">Laissez-vous guider</p>
          <h2 className="section-title">Inspirations Meritt Home</h2>
        </div>
        <ul className="grid gap-[18px] md:grid-cols-[1.4fr_1fr_1fr] md:grid-rows-1 md:h-[460px]">
          {COLLECTIONS.map((collection, index) => (
            <li key={collection.title} className={index === 0 ? 'h-[300px] md:h-auto' : 'h-60 md:h-auto'}>
              <div className="group relative h-full overflow-hidden rounded-[26px]">
                <ProductImage
                  src={images[index]?.image ?? collection.image}
                  alt=""
                  sizes="(min-width: 768px) 40vw, 100vw"
                  className="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                />
                <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/65 to-transparent px-6 pb-6 pt-16 text-white">
                  <h3 className="text-[1.375rem] text-white">{collection.title}</h3>
                  <p className="text-sm opacity-90">{collection.subtitle}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
