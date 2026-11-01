'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { uploadProductImage } from '@/lib/admin/storage';
import { Button } from '@/components/ui/button';

/** Taille maximale par défaut : 5 Mo. */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type ImageKind = 'image/jpeg' | 'image/png' | 'image/webp';

/** Détecte le format réel d'après les premiers octets, sans se fier à l'extension ni au type déclaré. */
export async function sniffImageType(file: Blob): Promise<ImageKind | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

interface ImagePickerProps {
  /** Taille maximale en octets (5 Mo par défaut). */
  maxBytes?: number;
  /** Appelé avec l'URL publique une fois l'envoi confirmé. */
  onUploaded: (url: string) => void;
  /** Appelé quand l'image choisie est retirée avant ou après envoi (l'URL du formulaire doit alors être retirée). */
  onCleared?: () => void;
  /** Signale au parent qu'un envoi est en cours (pour bloquer l'enregistrement). */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Sélection d'une image depuis l'ordinateur ou le téléphone, avec aperçu local.
 * Après validation, le fichier est envoyé dans le bucket public des images produit ; `onUploaded` reçoit l'URL publique.
 */
export function ImagePicker({ maxBytes = DEFAULT_MAX_IMAGE_BYTES, onUploaded, onCleared, onBusyChange }: ImagePickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function clear() {
    setPreview(null);
    setFileName(null);
    setError(null);
    setUploaded(false);
    if (inputRef.current) inputRef.current.value = '';
    onCleared?.();
  }

  async function handleChange(file: File | undefined) {
    if (!file) return;
    if (file.size > maxBytes) {
      setError(`L’image est trop lourde (${(file.size / 1_048_576).toFixed(1)} Mo). Maximum : ${(maxBytes / 1_048_576).toFixed(0)} Mo.`);
      return;
    }
    const kind = await sniffImageType(file);
    if (!kind) {
      setError('Format non pris en charge. Utilisez une image JPEG, PNG ou WebP.');
      return;
    }
    setError(null);
    setUploaded(false);
    setFileName(file.name);
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    onBusyChange?.(true);
    let result: Awaited<ReturnType<typeof uploadProductImage>>;
    try {
      result = await uploadProductImage(file, kind);
    } catch {
      result = { ok: false, message: 'L’envoi de l’image a échoué. Réessayez.' };
    } finally {
      // Le formulaire ne doit jamais rester bloqué après un envoi.
      setUploading(false);
      onBusyChange?.(false);
    }
    if (inputRef.current) inputRef.current.value = '';
    if (!result.ok) {
      // Aucune URL n'est transmise au formulaire si l'envoi échoue.
      setPreview(null);
      setFileName(null);
      setError(result.message);
      return;
    }
    setUploaded(true);
    onUploaded(result.data);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => void handleChange(event.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="mr-2 h-4 w-4" aria-hidden />
          {preview ? 'Remplacer l’image' : 'Choisir une image'}
        </Button>
        {preview && (
          <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={clear}>
            <X className="mr-2 h-4 w-4" aria-hidden />
            Retirer
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        JPEG, PNG ou WebP, {(maxBytes / 1_048_576).toFixed(0)} Mo maximum. Sur téléphone, vous pouvez choisir dans la galerie ou prendre une photo.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={`Aperçu de ${fileName ?? 'l’image'}`} className="h-28 w-28 rounded-md border object-cover" />
          {uploading && (
            <p role="status" className="text-xs text-muted-foreground">
              Envoi de l’image en cours…
            </p>
          )}
          {uploaded && (
            <p role="status" className="text-xs text-success">
              Image envoyée. Elle sera associée au produit quand vous l’enregistrerez.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
