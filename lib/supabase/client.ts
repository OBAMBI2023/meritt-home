import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase de Meritt Home (côté navigateur et serveur).
 *
 * N'utilise que l'URL du projet et la clé publishable : aucune clé secrète
 * (service_role) ne doit jamais être placée ici ni dans une variable NEXT_PUBLIC_*.
 * L'accès aux données est contrôlé par les politiques RLS du projet.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

let client: SupabaseClient | null = null;

/** Retourne le client partagé ; échoue clairement si l'environnement n'est pas configuré. */
export function getSupabase(): SupabaseClient {
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase non configuré : définissez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY dans .env.local.'
    );
  }
  if (!client) client = createClient(url, publishableKey);
  return client;
}
