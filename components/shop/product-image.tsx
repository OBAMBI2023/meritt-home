'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductImageProps {
  /** Une valeur absente affiche directement le repli « image indisponible ». */
  src: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

/**
 * Image avec fond de chargement et repli si la ressource est indisponible.
 * Le parent doit définir la taille (ratio) : l'image remplit son conteneur.
 */
export function ProductImage({ src, alt, className, sizes, priority }: ProductImageProps) {
  const [failed, setFailed] = useState(!src);
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    setFailed(!src);
  }, [src]);

  // Une image déjà chargée avant l'hydratation ne déclenche pas onLoad.
  useEffect(() => {
    const element = imageRef.current;
    if (!element?.complete) return;
    if (element.naturalWidth > 0) setLoaded(true);
    else setFailed(true);
  }, [src]);

  if (failed || !src) {
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt ? `${alt} (image indisponible)` : undefined}
        aria-hidden={alt ? undefined : true}
        className={cn('flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground', className)}
      >
        <ImageOff className="h-6 w-6" aria-hidden />
        <span className="text-xs">Image indisponible</span>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-muted', className)}>
      <Image
        ref={imageRef}
        src={src}
        alt={alt}
        fill
        sizes={sizes ?? '(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw'}
        priority={priority}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn('object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}
