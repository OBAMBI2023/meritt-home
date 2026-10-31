import { assertAdmin, type MutationResult } from '@/lib/admin/products';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Téléversement des images produit dans le bucket public `meritt-product-images`.
 * Le client utilise la session de l'administrateur : les politiques Storage décident (INSERT réservé aux administrateurs).
 */

export const PRODUCT_IMAGE_BUCKET = 'meritt-product-images';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type UploadableImageType = keyof typeof EXTENSIONS;

function describeStorageError(error: { message?: string; statusCode?: string | number } | null): string {
  const status = String(error?.statusCode ?? '');
  const message = (error?.message ?? '').toLowerCase();
  if (status === '413' || message.includes('too large') || message.includes('exceeded')) return 'L’image dépasse la taille maximale autorisée par le stockage (5 Mo).';
  if (status === '415' || message.includes('mime')) return 'Le stockage refuse ce format d’image (JPEG, PNG ou WebP uniquement).';
  if (status === '401' || status === '403' || message.includes('row-level security') || message.includes('unauthorized')) {
    return 'Envoi refusé : votre session n’a pas le droit d’ajouter des images. Reconnectez-vous puis réessayez.';
  }
  return 'L’envoi de l’image a échoué. Vérifiez votre connexion puis réessayez.';
}

/** `crypto.randomUUID` n'existe que dans un contexte sécurisé (https ou localhost) : repli pour un test mobile en http sur le réseau local. */
function uniqueId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Envoie le fichier sous `products/<uuid>.<ext>` et retourne son URL publique, uniquement si l'envoi a réussi. */
export async function uploadProductImage(file: File, type: UploadableImageType): Promise<MutationResult<string>> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const path = `products/${uniqueId()}.${EXTENSIONS[type]}`;
    const storage = getSupabase().storage.from(PRODUCT_IMAGE_BUCKET);
    const { error } = await storage.upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false });
    if (error) return { ok: false, message: describeStorageError(error as { message?: string; statusCode?: string }) };
    const { data } = storage.getPublicUrl(path);
    if (!data.publicUrl) return { ok: false, message: 'L’image a été envoyée mais son adresse publique est introuvable.' };
    return { ok: true, data: data.publicUrl };
  } catch {
    return { ok: false, message: 'L’envoi de l’image a échoué. Vérifiez votre connexion puis réessayez.' };
  }
}
