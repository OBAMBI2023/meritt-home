'use client';

import { useCallback, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { ProductFormDialog, type SubmitIntent } from '@/components/admin/sections/product-form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { createProduct, setProductPublished, updateProduct, type ProductFormValues } from '@/lib/admin/products';
import { fetchProductsAndCategories, type AdminProduct } from '@/lib/admin/queries';
import { formatPrice } from '@/lib/products';

type StatusFilter = 'all' | 'published' | 'draft';
type SortKey = 'name' | 'recent';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

export function ProductsSection() {
  const { state, reload } = useAdminQuery(fetchProductsAndCategories);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [dialog, setDialog] = useState<{ open: boolean; product: AdminProduct | null }>({ open: false, product: null });
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (state.status !== 'ready') return [];
    const needle = normalize(search);
    const filtered = state.data.products.filter((product) => {
      if (needle && !normalize(product.name).includes(needle)) return false;
      if (categoryFilter !== 'all' && product.categoryId !== categoryFilter) return false;
      if (statusFilter === 'published' && !product.published) return false;
      if (statusFilter === 'draft' && product.published) return false;
      return true;
    });
    return sort === 'recent'
      ? [...filtered].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      : [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [state, search, categoryFilter, statusFilter, sort]);

  const handleSubmit = useCallback(
    async (values: ProductFormValues, intent: SubmitIntent): Promise<string | null> => {
      const editing = dialog.product;
      const result = editing ? await updateProduct(editing.id, values, editing.imageUrls) : await createProduct(values, intent === 'publish');
      if (!result.ok) return result.message;

      // Brouillon existant publié depuis le formulaire : second appel explicite sur la colonne de statut.
      if (editing && intent === 'publish') {
        const published = await setProductPublished(editing.id, true);
        if (!published.ok) {
          reload();
          return `Informations enregistrées, mais la publication a échoué : ${published.message}`;
        }
      }
      toast.success(intent === 'publish' ? 'Produit publié.' : editing ? 'Modifications enregistrées.' : 'Brouillon enregistré.');
      setDialog({ open: false, product: null });
      reload();
      return null;
    },
    [dialog.product, reload]
  );

  async function togglePublished(product: AdminProduct) {
    setBusyId(product.id);
    const result = await setProductPublished(product.id, !product.published);
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(product.published ? 'Produit dépublié : il n’apparaît plus dans la boutique.' : 'Produit publié.');
    reload();
  }

  const categories = state.status === 'ready' ? state.data.categories : [];
  const categoryName = (id: string | null) => categories.find((category) => category.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Produits"
        description="Créez, modifiez, publiez et dépubliez vos produits. Seuls les produits publiés sont visibles dans la boutique."
        action={
          <Button type="button" onClick={() => setDialog({ open: true, product: null })} disabled={state.status !== 'ready'}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Ajouter un produit
          </Button>
        }
      />

      {state.status === 'loading' && <LoadingBlock label="Chargement des produits…" />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Rechercher un produit" placeholder="Rechercher par nom" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger aria-label="Filtrer par catégorie">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les catégories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger aria-label="Filtrer par statut">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="published">Publiés</SelectItem>
                <SelectItem value="draft">Brouillons</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger aria-label="Trier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Nom (A–Z)</SelectItem>
                <SelectItem value="recent">Plus récents</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {state.data.products.length === 0 ? (
            <EmptyState title="Aucun produit" text="Aucun produit n’existe encore. Utilisez « Ajouter un produit » pour créer le premier." />
          ) : rows.length === 0 ? (
            <EmptyState title="Aucun résultat" text="Aucun produit ne correspond à votre recherche ou à vos filtres." />
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead className="text-right">Prix</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">
                        {product.name}
                        <span className="block text-xs font-normal text-muted-foreground">{product.slug || '—'}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{categoryName(product.categoryId)}</TableCell>
                      <TableCell className="text-right">{formatPrice(product.price)}</TableCell>
                      <TableCell>
                        <Badge variant={product.published ? 'default' : 'secondary'}>{product.published ? 'Publié' : 'Brouillon'}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ open: true, product })}>
                          Modifier
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={product.published ? 'secondary' : 'default'}
                          disabled={busyId === product.id}
                          onClick={() => void togglePublished(product)}
                        >
                          {product.published ? 'Dépublier' : 'Publier'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <ProductFormDialog
        open={dialog.open}
        product={dialog.product}
        categories={categories}
        onClose={() => setDialog({ open: false, product: null })}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
