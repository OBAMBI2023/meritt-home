import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Authentification administrateur (Supabase Auth, e-mail + mot de passe).
 * Les messages d'erreur sont volontairement génériques : ils ne révèlent pas si un compte existe.
 */

export type SignInResult = { ok: true } | { ok: false; message: string };

export async function signInAdmin(email: string, password: string): Promise<SignInResult> {
  try {
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return { ok: true };
    if (isAuthApiError(error) && error.status === 429) {
      return { ok: false, message: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' };
    }
    if (isAuthRetryableFetchError(error)) {
      return { ok: false, message: 'Connexion impossible. Vérifiez votre connexion internet puis réessayez.' };
    }
    return { ok: false, message: 'E-mail ou mot de passe incorrect.' };
  } catch {
    return { ok: false, message: 'Connexion impossible pour le moment. Réessayez dans un instant.' };
  }
}

/** Déconnexion : révoque la session côté serveur Auth et efface le stockage local de ce navigateur. */
export async function signOutAdmin(): Promise<void> {
  try {
    await getSupabase().auth.signOut({ scope: 'local' });
  } catch {
    // Même si le réseau échoue, la session locale est supprimée par le client.
  }
}
