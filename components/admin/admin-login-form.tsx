'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandLogo } from '@/components/shop/brand-logo';
import { signInAdmin } from '@/lib/admin/auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AdminLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Saisissez une adresse e-mail valide.');
      return;
    }
    if (password === '') {
      setError('Saisissez votre mot de passe.');
      return;
    }
    setError('');
    setSubmitting(true);
    const result = await signInAdmin(email, password);
    setPassword('');
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
    }
    // En cas de succès, la session change et AdminGate prend le relais (vérification des droits).
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="space-y-3 text-center">
          <BrandLogo className="justify-center" />
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
            <Lock className="h-5 w-5" aria-hidden />
          </div>
          <h1 className="font-display text-2xl font-semibold">Espace administration</h1>
          <p className="text-sm text-muted-foreground">Accès réservé aux administrateurs de Meritt Home.</p>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Adresse e-mail</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'admin-login-error' : undefined}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Mot de passe</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'admin-login-error' : undefined}
              disabled={submitting}
            />
          </div>
          {error && (
            <p id="admin-login-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>

        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour à la boutique
        </Link>
      </div>
    </main>
  );
}
