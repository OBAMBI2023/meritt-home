'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAdminQuery } from '@/hooks/use-admin-query';
import {
  categoryFormSchema,
  createCategory,
  setCategoryActive,
  updateCategory,
  type CategoryFormInput,
  type CategoryFormValues,
} from '@/lib/admin/categories';
import { fetchAdminCategories, type AdminCategory } from '@/lib/admin/queries';

type Errors = Partial<Record<keyof CategoryFormInput, string>>;

const emptyForm: CategoryFormInput = { name: '', description: '', sortOrder: '0', active: false };

interface CategoryFormProps {
  open: boolean;
  category: AdminCategory | null;
  onClose: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<string | null>;
}

function CategoryFormDialog({ open, category, onClose, onSubmit }: CategoryFormProps) {
  const [form, setForm] = useState<CategoryFormInput>(emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      category
        ? { name: category.name, description: category.description ?? '', sortOrder: String(category.sortOrder), active: category.active }
        : emptyForm
    );
    setErrors({});
    setFormError(null);
    setPending(false);
  }, [open, category]);

  async function submit() {
    const parsed = categoryFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof CategoryFormInput] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    const message = await onSubmit(parsed.data);
    setPending(false);
    if (message) setFormError(message);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? 'Modifier la catégorie' : 'Ajouter une catégorie'}</DialogTitle>
          <DialogDescription>Une catégorie inactive n’est pas affichée dans la boutique.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Nom *</Label>
            <Input id="category-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-description">Description</Label>
            <Textarea id="category-description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-order">Ordre d’affichage</Label>
            <Input id="category-order" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} aria-invalid={!!errors.sortOrder} />
            {errors.sortOrder && <p className="text-sm text-destructive">{errors.sortOrder}</p>}
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="category-active">Catégorie active (visible dans la boutique)</Label>
            <Switch id="category-active" checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} />
          </div>
          {formError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesSection() {
  const { state, reload } = useAdminQuery(fetchAdminCategories);
  const [dialog, setDialog] = useState<{ open: boolean; category: AdminCategory | null }>({ open: false, category: null });
  const [confirmDeactivate, setConfirmDeactivate] = useState<AdminCategory | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (values: CategoryFormValues): Promise<string | null> => {
      const editing = dialog.category;
      const result = editing ? await updateCategory(editing.id, values) : await createCategory(values);
      if (!result.ok) return result.message;
      toast.success(editing ? 'Catégorie modifiée.' : 'Catégorie créée.');
      setDialog({ open: false, category: null });
      reload();
      return null;
    },
    [dialog.category, reload]
  );

  async function toggleActive(category: AdminCategory, active: boolean) {
    setBusyId(category.id);
    const result = await setCategoryActive(category.id, active);
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(active ? 'Catégorie activée.' : 'Catégorie désactivée.');
    reload();
  }

  const productCount = (id: string, publishedOnly = false) =>
    state.status === 'ready'
      ? state.data.products.filter((product) => product.categoryId === id && (!publishedOnly || product.published)).length
      : 0;

  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Catégories"
        description="Créez et modifiez vos catégories, activez-les ou désactivez-les. Le nombre de produits porte sur les produits lisibles par votre compte."
        action={
          <Button type="button" onClick={() => setDialog({ open: true, category: null })} disabled={state.status !== 'ready'}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Ajouter une catégorie
          </Button>
        }
      />

      {state.status === 'loading' && <LoadingBlock label="Chargement des catégories…" />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.categories.length === 0 ? (
          <EmptyState title="Aucune catégorie" text="Aucune catégorie n’existe encore. Utilisez « Ajouter une catégorie » pour créer la première." />
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Ordre</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Produits</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.data.categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">
                      {category.name}
                      <span className="block text-xs font-normal text-muted-foreground">{category.slug || '—'}</span>
                    </TableCell>
                    <TableCell>{category.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={category.active ? 'default' : 'secondary'}>{category.active ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{productCount(category.id)}</TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap text-right">
                      <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ open: true, category })}>
                        Modifier
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={category.active ? 'secondary' : 'default'}
                        disabled={busyId === category.id}
                        onClick={() => (category.active ? setConfirmDeactivate(category) : void toggleActive(category, true))}
                      >
                        {category.active ? 'Désactiver' : 'Activer'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}

      <CategoryFormDialog
        open={dialog.open}
        category={dialog.category}
        onClose={() => setDialog({ open: false, category: null })}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={confirmDeactivate !== null} onOpenChange={(open) => !open && setConfirmDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver « {confirmDeactivate?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeactivate && productCount(confirmDeactivate.id, true) > 0
                ? `${productCount(confirmDeactivate.id, true)} produit(s) publié(s) y sont rattachés. Ils ne sont pas modifiés, mais la catégorie ne sera plus proposée dans la boutique.`
                : 'La catégorie ne sera plus proposée dans la boutique. Vous pourrez la réactiver à tout moment.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeactivate) void toggleActive(confirmDeactivate, false);
                setConfirmDeactivate(null);
              }}
            >
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
