'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { checkImageFile, formatBytes, MAX_IMAGES, type ImageKind } from '@/lib/custom-requests';
import { cn } from '@/lib/utils';

export interface PickedImage {
  id: string;
  file: File;
  kind: ImageKind;
  previewUrl: string;
}

let counter = 0;
const nextImageId = () => `img-${(counter += 1)}`;

/**
 * Zone de dépôt : aperçu, suppression individuelle, validation du format (JPG, JPEG, PNG, WEBP) et de la taille (5 Mo).
 * Le total d'images (inspirations + espace existant) est plafonné à MAX_IMAGES par le formulaire parent.
 */
export function ImageDropzone({
  kind,
  title,
  description,
  images,
  onAdd,
  onRemove,
}: {
  kind: ImageKind;
  title: string;
  description: string;
  images: PickedImage[];
  /** Retourne les messages de refus à afficher (liste vide si tout a été accepté). */
  onAdd: (files: File[], kind: ImageKind) => string[];
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const mine = images.filter((image) => image.kind === kind);
  const full = images.length >= MAX_IMAGES;

  const receive = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setMessages(onAdd(Array.from(list), kind));
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!full) receive(event.dataTransfer.files);
  };

  const inputId = `dropzone-${kind}`;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">(facultatif)</span>
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'relative flex flex-col items-center gap-2 rounded-[18px] border-2 border-dashed px-4 py-7 text-center transition-colors focus-within:ring-2 focus-within:ring-ring',
          dragging ? 'border-primary bg-accent' : 'border-input bg-muted/40',
          full && 'opacity-60'
        )}
      >
        <ImagePlus className="h-7 w-7 text-muted-foreground" aria-hidden />
        <p className="text-sm">
          <label htmlFor={inputId} className={cn('font-semibold text-primary underline-offset-4', full ? 'cursor-not-allowed' : 'cursor-pointer hover:underline')}>
            {full ? 'Limite atteinte' : 'Choisir des images'}
          </label>
          {!full && <span className="hidden text-muted-foreground sm:inline"> ou glissez-les ici</span>}
        </p>
        <p className="text-xs text-muted-foreground">JPG, JPEG, PNG ou WEBP · 5 Mo maximum par image · {MAX_IMAGES} images au total</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          disabled={full}
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          onChange={(event) => receive(event.target.files)}
          className="sr-only"
        />
      </div>

      {messages.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {mine.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={title}>
          {mine.map((image) => (
            <li key={image.id} className="relative aspect-square overflow-hidden rounded-[13px] border bg-muted">
              {/* Aperçu local (blob:) : une balise img native est nécessaire. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewUrl} alt={`Aperçu de ${image.file.name}`} className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{formatBytes(image.file.size)}</span>
              <button
                type="button"
                onClick={() => onRemove(image.id)}
                aria-label={`Retirer ${image.file.name}`}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Libère les URL d'aperçu au démontage de la page. */
export function useRevokePreviews(images: PickedImage[]) {
  const latest = useRef(images);
  latest.current = images;
  useEffect(
    () => () => {
      for (const image of latest.current) URL.revokeObjectURL(image.previewUrl);
    },
    []
  );
}

/** Filtre les fichiers choisis (format, taille, doublon, limite) et crée les aperçus des fichiers retenus. */
export function buildPicked(files: File[], kind: ImageKind, existing: PickedImage[]): { picked: PickedImage[]; messages: string[] } {
  const picked: PickedImage[] = [];
  const messages: string[] = [];
  let room = MAX_IMAGES - existing.length;
  for (const file of files) {
    const check = checkImageFile(file);
    if (!check.ok) {
      messages.push(check.message ?? `« ${file.name} » est refusée.`);
      continue;
    }
    if (existing.some((image) => image.file.name === file.name && image.file.size === file.size && image.file.lastModified === file.lastModified)) {
      messages.push(`« ${file.name} » est déjà ajoutée.`);
      continue;
    }
    if (room <= 0) {
      messages.push(`Limite de ${MAX_IMAGES} images atteinte : « ${file.name} » n’a pas été ajoutée.`);
      continue;
    }
    room -= 1;
    picked.push({ id: nextImageId(), file, kind, previewUrl: URL.createObjectURL(file) });
  }
  return { picked, messages };
}
