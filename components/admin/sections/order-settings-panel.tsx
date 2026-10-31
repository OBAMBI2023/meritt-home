'use client';

import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAdminQuery } from '@/hooks/use-admin-query';
import {
  addDeliveryFee,
  feeFormSchema,
  fetchOrderConfig,
  pickupAddressSchema,
  updateDeliveryFee,
  updatePickupAddress,
  updateStockPolicy,
  type DeliveryFee,
  type OrderSettings,
  type StockPolicy,
} from '@/lib/admin/config';

const POLICIES: { id: StockPolicy; label: string; text: string }[] = [
  {
    id: 'reject',
    label: 'Refuser la commande',
    text: 'Un produit sans quantité suivie ne peut pas être commandé. Aucune vente ne peut dépasser le stock réel.',
  },
  {
    id: 'allow',
    label: 'Accepter sans décrémenter le stock',
    text: 'Un produit sans quantité suivie est vendu sans contrôle ni décrément : le stock réel n’est pas vérifié.',
  },
];

function FeeRow({ fee, onSaved }: { fee: DeliveryFee; onSaved: () => void }) {
  const [value, setValue] = useState(String(fee.fee));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(String(fee.fee)), [fee.fee]);

  async function saveFee() {
    const parsed = feeFormSchema.shape.fee.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    setBusy(true);
    const result = await updateDeliveryFee(fee.commune, { fee: parsed.data });
    setBusy(false);
    if (!result.ok) return void toast.error(result.message);
    toast.success(`Tarif de ${fee.commune} enregistré.`);
    onSaved();
  }

  async function toggle() {
    setBusy(true);
    const result = await updateDeliveryFee(fee.commune, { active: !fee.active });
    setBusy(false);
    if (!result.ok) return void toast.error(result.message);
    toast.success(fee.active ? `Livraison désactivée pour ${fee.commune}.` : `Livraison activée pour ${fee.commune}.`);
    onSaved();
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{fee.commune}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input aria-label={`Tarif de ${fee.commune} en FCFA`} inputMode="numeric" className="h-9 w-28" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          <span className="text-xs text-muted-foreground">FCFA</span>
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </TableCell>
      <TableCell>
        <Badge variant={fee.active ? 'default' : 'secondary'}>{fee.active ? 'Active' : 'Désactivée'}</Badge>
      </TableCell>
      <TableCell className="space-x-2 whitespace-nowrap text-right">
        <Button type="button" size="sm" variant="outline" disabled={busy || value.trim() === String(fee.fee)} onClick={() => void saveFee()}>
          Enregistrer
        </Button>
        <Button type="button" size="sm" variant={fee.active ? 'secondary' : 'default'} disabled={busy} onClick={() => void toggle()}>
          {fee.active ? 'Désactiver' : 'Activer'}
        </Button>
      </TableCell>
    </TableRow>
  );
}

const sameCommune = (a: string, b: string) => normalizeCommune(a) === normalizeCommune(b);
function normalizeCommune(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/s+/g, ' ')
    .trim();
}

function AddFeeForm({ existing, onSaved }: { existing: DeliveryFee[]; onSaved: () => void }) {
  const [commune, setCommune] = useState('');
  const [fee, setFee] = useState('');
  const [errors, setErrors] = useState<{ commune?: string; fee?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = feeFormSchema.safeParse({ commune, fee });
    if (!parsed.success) {
      const next: { commune?: string; fee?: string } = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as 'commune' | 'fee'] ??= issue.message;
      setErrors(next);
      return;
    }
    // Le nom est la clé en base et distingue majuscules et accents : on évite ici les doublons « Cocody » / « cocody ».
    const duplicate = existing.find((entry) => sameCommune(entry.commune, parsed.data.commune));
    if (duplicate) {
      setErrors({ commune: `Cette zone existe déjà (« ${duplicate.commune} ») : modifiez son tarif dans la liste.` });
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await addDeliveryFee(parsed.data.commune, parsed.data.fee);
    setBusy(false);
    if (!result.ok) return void toast.error(result.message);
    toast.success(`Livraison ajoutée pour ${parsed.data.commune}.`);
    setCommune('');
    setFee('');
    onSaved();
  }

  return (
    <form
      noValidate
      className="grid gap-3 rounded-md border border-dashed p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="fee-commune">Nouvelle commune</Label>
        <Input id="fee-commune" value={commune} onChange={(e) => setCommune(e.target.value)} aria-invalid={!!errors.commune} />
        {errors.commune && <p className="text-xs text-destructive">{errors.commune}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fee-amount">Tarif (FCFA)</Label>
        <Input id="fee-amount" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} aria-invalid={!!errors.fee} />
        {errors.fee && <p className="text-xs text-destructive">{errors.fee}</p>}
      </div>
      <Button type="submit" className="sm:mt-[1.625rem]" disabled={busy}>
        {busy ? 'Ajout…' : 'Ajouter'}
      </Button>
    </form>
  );
}

function PickupForm({ settings, onSaved }: { settings: OrderSettings; onSaved: () => void }) {
  const [value, setValue] = useState(settings.pickupAddress ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(settings.pickupAddress ?? ''), [settings.pickupAddress]);

  async function submit() {
    const parsed = pickupAddressSchema.safeParse(value);
    if (!parsed.success) return void setError(parsed.error.issues[0].message);
    setError(null);
    setBusy(true);
    const result = await updatePickupAddress(parsed.data);
    setBusy(false);
    if (!result.ok) return void toast.error(result.message);
    toast.success(parsed.data === '' ? 'Adresse de retrait retirée.' : 'Adresse de retrait enregistrée.');
    onSaved();
  }

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm">
        Enregistrée actuellement :{' '}
        <span className="font-medium">{settings.pickupAddress ?? 'aucune (les clients voient « lieu à convenir »)'}</span>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="pickup-address">Adresse officielle de retrait</Label>
        <Textarea id="pickup-address" rows={3} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">Laissez vide pour ne rien afficher. Cette adresse est visible par tous les clients choisissant le retrait.</p>
      </div>
      <Button type="submit" disabled={busy || value.trim() === (settings.pickupAddress ?? '')}>
        {busy ? 'Enregistrement…' : 'Enregistrer l’adresse'}
      </Button>
    </form>
  );
}

function PolicyForm({ settings, onSaved }: { settings: OrderSettings; onSaved: () => void }) {
  const [value, setValue] = useState<StockPolicy>(settings.policy);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(settings.policy), [settings.policy]);

  async function submit() {
    setBusy(true);
    const result = await updateStockPolicy(value);
    setBusy(false);
    if (!result.ok) return void toast.error(result.message);
    toast.success('Règle enregistrée.');
    onSaved();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Produits dont la quantité n’est pas suivie</legend>
        {POLICIES.map((policy) => (
          <label key={policy.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${value === policy.id ? 'border-primary bg-accent' : 'hover:bg-accent/50'}`}>
            <input type="radio" name="stock-policy" className="mt-1" checked={value === policy.id} onChange={() => setValue(policy.id)} />
            <span className="space-y-0.5 text-sm">
              <span className="block font-medium">
                {policy.label}
                {settings.policy === policy.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(règle actuelle)</span>}
              </span>
              <span className="block text-muted-foreground">{policy.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        S’applique aux produits sans ligne de stock ou dont la quantité est inconnue (voir « Stocks »). Les produits avec une quantité renseignée sont toujours contrôlés et décrémentés.
      </p>
      <Button type="submit" disabled={busy || value === settings.policy}>
        {busy ? 'Enregistrement…' : 'Enregistrer la règle'}
      </Button>
    </form>
  );
}

export function OrderSettingsPanel() {
  const { state, reload } = useAdminQuery(fetchOrderConfig);

  return (
    <>
      <Toaster position="top-center" richColors closeButton />
      {state.status === 'loading' && <LoadingBlock label="Chargement des paramètres de commande…" />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' && (
        <div className="space-y-6">
          <section aria-labelledby="fees-title" className="space-y-4 rounded-lg border bg-card p-5">
            <div className="space-y-1">
              <h3 id="fees-title" className="font-sans text-base font-semibold">
                Zones et tarifs de livraison
              </h3>
              <p className="text-sm text-muted-foreground">
                La livraison n’est proposée aux clients que pour les communes actives. Sans aucun tarif actif, seul le retrait sur place est possible. Le nom d’une commune ne peut pas être modifié.
              </p>
            </div>
            <p className="text-sm" role="status">
              {state.data.fees.length} zone(s) configurée(s), dont <span className="font-medium">{state.data.fees.filter((fee) => fee.active).length} active(s)</span>.{" "}
              {state.data.fees.some((fee) => fee.active)
                ? "La livraison est proposée aux clients pour les zones actives."
                : "Aucune zone active : les clients ne peuvent choisir que le retrait sur place."}
            </p>
            {state.data.fees.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun tarif enregistré : la livraison est indisponible pour les clients.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Commune</TableHead>
                      <TableHead>Tarif</TableHead>
                      <TableHead>État</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.fees.map((fee) => (
                      <FeeRow key={fee.commune} fee={fee} onSaved={reload} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <AddFeeForm existing={state.data.fees} onSaved={reload} />
          </section>

          {state.data.settings === null ? (
            <p role="alert" className="rounded-lg border border-dashed bg-card p-5 text-sm text-muted-foreground">
              Les paramètres de commande (adresse de retrait, règle de stock) sont illisibles : la ligne de configuration est absente ou votre compte n’a pas le droit de la lire.
            </p>
          ) : (
            <>
              <section aria-labelledby="pickup-title" className="space-y-4 rounded-lg border bg-card p-5">
                <h3 id="pickup-title" className="font-sans text-base font-semibold">
                  Retrait sur place
                </h3>
                <PickupForm settings={state.data.settings} onSaved={reload} />
              </section>

              <section aria-labelledby="policy-title" className="space-y-4 rounded-lg border bg-card p-5">
                <h3 id="policy-title" className="font-sans text-base font-semibold">
                  Produits dont le stock n’est pas suivi
                </h3>
                <PolicyForm settings={state.data.settings} onSaved={reload} />
              </section>

              <section aria-labelledby="limits-title" className="space-y-2 rounded-lg border bg-card p-5">
                <h3 id="limits-title" className="font-sans text-base font-semibold">
                  Limites anti-abus (lecture seule)
                </h3>
                <p className="text-sm">
                  Par numéro de téléphone : <span className="font-medium">{state.data.settings.maxPerHour}</span> commande(s) par heure et{' '}
                  <span className="font-medium">{state.data.settings.maxPerDay}</span> par jour.
                </p>
                <p className="text-xs text-muted-foreground">Ces valeurs se modifient directement dans Supabase.</p>
              </section>
            </>
          )}
        </div>
      )}
    </>
  );
}
