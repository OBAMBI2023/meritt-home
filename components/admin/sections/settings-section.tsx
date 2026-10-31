'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { z } from 'zod';
import { SectionHeader } from '@/components/admin/admin-ui';
import { CompanySettingsPanel } from '@/components/admin/sections/company-settings-panel';
import { OrderSettingsPanel } from '@/components/admin/sections/order-settings-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdmin } from '@/components/admin/admin-context';
import { getSupabase } from '@/lib/supabase/client';

const passwordSchema = z
  .object({
    password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.').max(72, 'Le mot de passe est trop long (72 caractères maximum).'),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { path: ['confirm'], message: 'Les deux mots de passe ne correspondent pas.' });

function PasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setResult(null);
    const parsed = passwordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      const next: { password?: string; confirm?: string } = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as 'password' | 'confirm'] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password: parsed.data.password });
      if (error) {
        setResult({ ok: false, message: 'Le mot de passe n’a pas été modifié. Reconnectez-vous puis réessayez, ou choisissez un mot de passe différent.' });
      } else {
        setPassword('');
        setConfirm('');
        setResult({ ok: true, message: 'Mot de passe modifié.' });
      }
    } catch {
      setResult({ ok: false, message: 'Connexion impossible pour le moment. Réessayez dans un instant.' });
    }
    setPending(false);
  }

  return (
    <form
      noValidate
      className="max-w-sm space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="new-password">Nouveau mot de passe</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
        {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
        {errors.confirm && <p className="text-sm text-destructive">{errors.confirm}</p>}
      </div>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>
          {result.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Modification…' : 'Changer le mot de passe'}
      </Button>
    </form>
  );
}

export function SettingsSection() {
  const { user, signOut } = useAdmin();

  return (
    <div className="space-y-6">
      <SectionHeader title="Paramètres" description="Commandes et livraison, compte administrateur et mot de passe." />

      <OrderSettingsPanel />

      <CompanySettingsPanel />

      <section aria-labelledby="account-title" className="space-y-4 rounded-lg border bg-card p-5">
        <h3 id="account-title" className="font-sans text-base font-semibold">
          Compte connecté
        </h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Adresse e-mail</dt>
          <dd className="font-medium">{user.email ?? '—'}</dd>
          <dt className="text-muted-foreground">Rôle</dt>
          <dd className="font-medium">Administrateur (vérifié par la base de données)</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          La session est conservée dans ce navigateur. Déconnectez-vous sur un ordinateur partagé.
        </p>
        <Button type="button" variant="outline" onClick={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          Se déconnecter
        </Button>
      </section>

      <section aria-labelledby="password-title" className="space-y-4 rounded-lg border bg-card p-5">
        <h3 id="password-title" className="font-sans text-base font-semibold">
          Mot de passe
        </h3>
        <PasswordForm />
      </section>
    </div>
  );
}
