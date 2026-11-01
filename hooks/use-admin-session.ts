'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAuthApiError } from '@supabase/supabase-js';
import { signOutAdmin } from '@/lib/admin/auth';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

export interface AdminUser {
  id: string;
  email: string | null;
}

export type AdminSessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'checking' }
  | { status: 'denied'; email: string | null }
  | { status: 'error'; email: string | null; message: string }
  | { status: 'authorized'; user: AdminUser };

/**
 * Session administrateur.
 *
 * Aucune décision n'est prise à partir du stockage local ou d'un indicateur JavaScript :
 *  1. le jeton est validé par le serveur Supabase Auth (`getUser`) ;
 *  2. le droit administrateur est tranché par la base : fonction `is_admin()` (celle qu'utilisent les
 *     politiques RLS), ou à défaut la ligne de `public.admin_users` lisible par l'utilisateur lui-même.
 * Toute erreur ferme l'accès (refus par défaut). Les données elles-mêmes restent protégées par la RLS.
 */
export function useAdminSession() {
  const [state, setState] = useState<AdminSessionState>({ status: 'loading' });
  const evaluation = useRef(0);

  const evaluate = useCallback(async () => {
    const current = ++evaluation.current;
    const apply = (next: AdminSessionState) => {
      if (current === evaluation.current) setState(next);
    };

    if (!isSupabaseConfigured) {
      apply({ status: 'error', email: null, message: 'La connexion à Supabase n’est pas configurée.' });
      return;
    }

    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      apply({ status: 'signed_out' });
      return;
    }

    setState((previous) => (previous.status === 'authorized' ? previous : { status: 'checking' }));

    // 1. Validation du jeton auprès du serveur Auth (on ne se fie pas au contenu du stockage local).
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      if (isAuthApiError(userError) && userError.status >= 400 && userError.status < 500) {
        await signOutAdmin();
        apply({ status: 'signed_out' });
      } else {
        apply({ status: 'error', email: null, message: 'Impossible de vérifier votre session. Réessayez.' });
      }
      return;
    }
    const user: AdminUser = { id: userData.user.id, email: userData.user.email ?? null };

    // 2. Autorisation décidée par la base de données.
    const check = await supabase.rpc('is_admin');
    if (!check.error && typeof check.data === 'boolean') {
      apply(check.data ? { status: 'authorized', user } : { status: 'denied', email: user.email });
      return;
    }
    const fallback = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
    if (fallback.error) {
      apply({
        status: 'error',
        email: user.email,
        message: 'Impossible de vérifier vos autorisations. L’accès est refusé par précaution.',
      });
      return;
    }
    apply(fallback.data ? { status: 'authorized', user } : { status: 'denied', email: user.email });
  }, []);

  useEffect(() => {
    void evaluate();
    if (!isSupabaseConfigured) return;
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        evaluation.current += 1;
        setState({ status: 'signed_out' });
      } else if (event === 'SIGNED_IN') {
        // Ne pas appeler Supabase directement dans ce rappel : on reporte l'évaluation.
        setTimeout(() => void evaluate(), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [evaluate]);

  const signOut = useCallback(async () => {
    evaluation.current += 1;
    await signOutAdmin();
    setState({ status: 'signed_out' });
  }, []);

  return { state, signOut, retry: evaluate };
}
