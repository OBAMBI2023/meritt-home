'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Inbox, RefreshCw, Search, ShieldAlert, WifiOff } from 'lucide-react';
import { EmptyState, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { STATUSES, STATUS_LABELS, fetchCustomRequests, isCustomModuleMissing, type CustomRequestRow, type CustomStatus } from '@/lib/admin/custom-requests';
import { PROJECT_TYPES, labelOf } from '@/lib/custom-requests';
import { getSupabase } from '@/lib/supabase/client';

/** Référence du projet Supabase réellement interrogé, tirée de l'URL publique (jamais de clé). */
export function supabaseProjectRef(): string | null {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
    return host.endsWith('.supabase.co') ? host.split('.')[0] : host || null;
  } catch {
    return null;
  }
}

type ErrorKind = 'missing' | 'permission' | 'network' | 'other';
type Probe = { status: number | null; code: string | null; unreachable: boolean };

/** Distingue une table absente, un refus de droits, une panne réseau et les autres erreurs. */
function classify(code: string | null, status: number | null, unreachable: boolean): ErrorKind {
  if (isCustomModuleMissing(code)) return 'missing';
  if (code === '42501' || status === 401 || status === 403) return 'permission';
  if (unreachable || (code === null && (status === null || status === 0 || status >= 500))) return 'network';
  return 'other';
}

const KIND_TEXT: Record<ErrorKind, { title: string; label: string }> = {
  missing: { title: 'Module non installé', label: 'Table ou fonction absente du projet' },
  permission: { title: 'Accès refusé par la base', label: 'Erreur de permissions (RLS ou droits)' },
  network: { title: 'Connexion à Supabase impossible', label: 'Erreur réseau ou service indisponible' },
  other: { title: 'Lecture impossible', label: 'Autre erreur Supabase' },
};

/**
 * Diagnostic d'une erreur de lecture du module. Le code HTTP n'est pas transporté par l'erreur de lecture : une lecture
 * de contrôle (1 ligne, session de l'administrateur, donc soumise à la RLS) est faite uniquement quand une erreur survient.
 */
export function ModuleDiagnostic({ code, onRetry }: { code: string | null; onRetry: () => void }) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const ref = supabaseProjectRef();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getSupabase().from('custom_requests').select('id').limit(1);
        if (!cancelled) setProbe({ status: result.status ?? null, code: result.error?.code || null, unreachable: result.status === 0 });
      } catch {
        if (!cancelled) setProbe({ status: null, code: null, unreachable: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shownCode = probe?.code ?? code;
  const kind = classify(shownCode, probe?.status ?? null, probe?.unreachable ?? false);
  const Icon = kind === 'missing' ? Inbox : kind === 'permission' ? ShieldAlert : kind === 'network' ? WifiOff : AlertTriangle;
  const project = ref ? `« ${ref} »` : 'inconnu (URL Supabase non configurée)';
  const advice: Record<ErrorKind, string> = {
    missing: `Les tables du module sont absentes du projet Supabase ${project}, celui auquel cette application est connectée. Appliquez migration-sur-mesure.sql sur CE projet, ou ouvrez l’application branchée sur le projet où la migration est installée, puis rechargez.`,
    permission: `Le module existe sur le projet ${project}, mais la base refuse la lecture à ce compte. Vérifiez que vous êtes connecté avec un compte administrateur de ce projet.`,
    network: `Le projet ${project} n’a pas répondu. Vérifiez votre connexion internet et l’état du service Supabase, puis réessayez. Ce n’est pas une absence du module.`,
    other: `La lecture sur le projet ${project} a échoué pour une raison non identifiée. Les codes ci-dessous aident à la diagnostiquer.`,
  };

  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-10 text-center">
      <Icon className="h-7 w-7 text-muted-foreground" aria-hidden />
      <h3 className="text-lg font-semibold">{KIND_TEXT[kind].title}</h3>
      <p className="max-w-xl text-sm text-muted-foreground">{advice[kind]}</p>
      <dl className="grid w-full max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-left text-xs">
        <dt className="text-muted-foreground">Projet interrogé</dt>
        <dd className="font-mono">{ref ?? 'inconnu'}</dd>
        <dt className="text-muted-foreground">Code HTTP</dt>
        <dd className="font-mono">{probe === null ? 'vérification…' : probe.status === null || probe.status === 0 ? 'aucune réponse' : probe.status}</dd>
        <dt className="text-muted-foreground">Code d’erreur Supabase</dt>
        <dd className="font-mono">{shownCode ?? 'aucun'}</dd>
        <dt className="text-muted-foreground">Diagnostic</dt>
        <dd>{KIND_TEXT[kind].label}</dd>
      </dl>
      <Button type="button" variant="outline" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
        Réessayer
      </Button>
    </div>
  );
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function StatusBadge({ status }: { status: CustomStatus }) {
  const variant = status === 'new' ? 'default' : status === 'refused' ? 'destructive' : status === 'accepted' || status === 'completed' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

const digits = (value: string) => value.replace(/\D/g, '');

function matches(row: CustomRequestRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const qDigits = digits(q);
  return row.name.toLowerCase().includes(q) || row.reference.toLowerCase().includes(q) || (qDigits.length >= 3 && digits(row.phone).includes(qDigits));
}

export function CustomRequestsSection() {
  const { state, reload } = useAdminQuery(fetchCustomRequests);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | CustomStatus>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const data = state.status === 'ready' ? state.data : null;
  const filtered = useMemo(() => {
    if (!data) return [];
    return data.requests.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      // Dates comparées en jour local (AAAA-MM-JJ).
      const day = new Date(row.createdAt);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      if (from && iso < from) return false;
      if (to && iso > to) return false;
      return matches(row, query);
    });
  }, [data, query, status, from, to]);

  const filtering = query !== '' || status !== 'all' || from !== '' || to !== '';

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Demandes sur mesure"
        description="Demandes envoyées depuis la page Création sur mesure : inspirations, dimensions, budget et délai souhaités. Une demande n’est jamais convertie automatiquement en commande."
      />

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 lg:col-span-1">
          <Label htmlFor="cr-search">Recherche</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="cr-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, téléphone ou référence" className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-status">Statut</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as 'all' | CustomStatus)}>
            <SelectTrigger id="cr-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-from">Reçues à partir du</Label>
          <Input id="cr-from" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-to">Reçues jusqu’au</Label>
          <Input id="cr-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>

      {state.status === 'loading' && <LoadingBlock label="Chargement des demandes…" />}
      {state.status === 'error' && <ModuleDiagnostic code={state.code} onRetry={reload} />}

      {data && data.requests.length === 0 && <EmptyState title="Aucune demande pour l’instant" text="Les demandes envoyées depuis la page Création sur mesure apparaîtront ici." />}
      {data && data.requests.length > 0 && filtered.length === 0 && (
        <EmptyState title="Aucun résultat" text="Aucune demande ne correspond à ces critères. Modifiez la recherche ou les filtres." />
      )}

      {filtered.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {filtered.length} demande{filtered.length > 1 ? 's' : ''}
            {filtering ? ' correspondant aux critères' : ''}
            {data?.truncated ? ` · affichage limité aux ${data.requests.length} plus récentes : affinez avec les filtres de date` : ''}
          </p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Projet</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Reçue le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link href={`/admin/sur-mesure/voir?id=${row.id}`} className="text-primary underline-offset-4 hover:underline">
                        {row.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">{row.phone}</span>
                    </TableCell>
                    <TableCell>{labelOf(PROJECT_TYPES, row.projectType)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>{row.assignedTo ?? <span className="text-muted-foreground">Non attribuée</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
