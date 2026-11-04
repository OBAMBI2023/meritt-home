'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { fetchOrderSettings, fetchStockProducts, setStockQuantity, stockQuantitySchema, type StockPolicy, type StockProduct, type StockState } from '@/lib/admin/config';
import { outOfStockConflict } from '@/lib/admin/products';

type Filter = 'all' | StockState;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const STATE_LABEL: Record<StockState, string> = {
  untracked: 'Non suivi',
  unknown: 'Quantité inconnue',
  zero: 'Épuisé (0)',
  tracked: 'En stock',
};

/** Chargement unique (fonction stable) : produits avec leur stock, et la règle actuelle pour les stocks non suivis. */
async function loadStockPage(): Promise<{ products: StockProduct[]; policy: StockPolicy | null }> {
  const products = await fetchStockProducts();
  // La règle n'est qu'une information : son échec n'empêche pas d'afficher les stocks.
  const policy = await fetchOrderSettings().then((settings) => settings?.policy ?? null).catch(() => null);
  return { products, policy };
}

function StockRow({ product, onSaved }: { product: StockProduct; onSaved: () => void }) {
  const current = product.quantity === undefined || product.quantity === null ? '' : String(product.quantity);
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(current), [current]);
  /** Produit « sur commande » : la quantité éventuelle est conservée mais n'a aucun effet ; sa saisie est désactivée. */
  const onDemand = product.inventoryMode === 'on_demand';

  async function save() {
    const parsed = stockQuantitySchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    const conflict = outOfStockConflict(product.unavailable ? 'unavailable' : 'available', onDemand ? 'on_demand' : 'tracked', parsed.data, 'stocks');
    if (conflict) {
      setError(conflict);
      return;
    }
    setError(null);
    setBusy(true);
    const result = await setStockQuantity(product.productId, parsed.data, product.quantity);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      onSaved();
      return;
    }
    toast.success(`Stock de « ${product.name} » enregistré : ${parsed.data}.`);
    onSaved();
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{product.name}</TableCell>
      <TableCell>
        <Badge variant={product.published ? 'default' : 'secondary'}>{product.published ? 'Publié' : 'Brouillon'}</Badge>
      </TableCell>
      <TableCell>
        {onDemand ? (
          <Badge variant="outline">Sur commande</Badge>
        ) : (
          <Badge variant={product.state === 'tracked' ? 'outline' : 'secondary'}>{STATE_LABEL[product.state]}</Badge>
        )}
        {(product.state === 'tracked' || (onDemand && typeof product.quantity === 'number')) && <span className="ml-2 text-sm">{product.quantity}</span>}
        {product.unavailable && <Badge variant="destructive" className="ml-2">Indisponible</Badge>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Quantité de ${product.name}`}
            inputMode="numeric"
            className="h-9 w-24"
            placeholder="Quantité"
            value={value}
            disabled={onDemand}
            title={onDemand ? 'Produit sur commande : le stock n’est pas suivi. Changez le mode dans Produits pour saisir une quantité.' : undefined}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={!!error}
          />
          <Button type="button" size="sm" disabled={onDemand || busy || value.trim() === '' || value.trim() === current} onClick={() => void save()}>
            {busy ? '…' : 'Enregistrer'}
          </Button>
        </div>
        {error && <p className="mt-1 max-w-xs text-xs text-destructive">{error}</p>}
        {onDemand && <p className="mt-1 max-w-xs text-xs text-muted-foreground">Produit sur commande : stock non suivi (quantité conservée, sans effet).</p>}
      </TableCell>
    </TableRow>
  );
}

export function StockSection() {
  const { state, reload } = useAdminQuery(loadStockPage);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    if (state.status !== 'ready') return [];
    const needle = normalize(search);
    return state.data.products.filter((row) => (!needle || normalize(row.name).includes(needle)) && (filter === 'all' || row.state === filter));
  }, [state, search, filter]);

  const policyText =
    state.status === 'ready' && state.data.policy
      ? state.data.policy === 'reject'
        ? 'Règle actuelle : un produit en gestion du stock « non suivi » ou à « quantité inconnue » ne peut pas être commandé (les produits « sur commande » ne sont pas concernés ; mode réglable par produit dans Produits).'
        : 'Règle actuelle : un produit « non suivi » ou à « quantité inconnue » est vendu sans contrôle ni décrément du stock.'
      : null;

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Stocks"
        description="Saisissez la quantité disponible de chaque produit. Un stock renseigné est contrôlé et décrémenté à chaque commande, et restitué si la commande est annulée."
      />

      {state.status === 'loading' && <LoadingBlock label="Chargement des stocks…" />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.products.length === 0 ? (
          <EmptyState title="Aucun produit" text="Aucun produit n’existe encore, donc aucun stock à renseigner." />
        ) : (
          <>
            <div className="space-y-1 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Non suivi</span> : aucune quantité n’a jamais été saisie.{' '}
                <span className="font-medium text-foreground">Quantité inconnue</span> : une ligne existe sans quantité.{' '}
                <span className="font-medium text-foreground">Épuisé</span> : la quantité est 0.
              </p>
              {policyText ? <p>{policyText} (modifiable dans Paramètres)</p> : <p>La règle des stocks non suivis n’a pas pu être lue (voir Paramètres).</p>}
              <p>La quantité saisie remplace la quantité affichée. Si une commande a modifié le stock entre-temps, l’enregistrement est refusé et la liste se recharge.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Rechercher un produit" placeholder="Rechercher par nom" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
                <SelectTrigger aria-label="Filtrer par état du stock">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les états</SelectItem>
                  <SelectItem value="untracked">Non suivi</SelectItem>
                  <SelectItem value="unknown">Quantité inconnue</SelectItem>
                  <SelectItem value="zero">Épuisé (0)</SelectItem>
                  <SelectItem value="tracked">En stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="Aucun résultat" text="Aucun produit ne correspond à votre recherche ou à votre filtre." />
            ) : (
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit</TableHead>
                      <TableHead>Publication</TableHead>
                      <TableHead>État du stock</TableHead>
                      <TableHead>Nouvelle quantité</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <StockRow key={row.productId} product={row} onSaved={reload} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ))}
    </div>
  );
}
