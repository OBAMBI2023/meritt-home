'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ImagePicker } from '@/components/admin/image-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AdminCategory, AdminProduct } from '@/lib/admin/queries';
import { productFormSchema, type ProductFormInput, type ProductFormValues } from '@/lib/admin/products';

type FieldErrors = Partial<Record<keyof ProductFormInput, string>>;

const emptyForm: ProductFormInput = { name: '', description: '', price: '', categoryId: '', imageUrl: '' };

function fromProduct(product: AdminProduct | null): ProductFormInput {
  if (!product) return emptyForm;
  return {
    name: product.name,
    description: product.description ?? '',
    price: String(product.price),
    categoryId: product.categoryId ?? '',
    imageUrl: product.imageUrls[0] ?? '',
  };
}

export type SubmitIntent = 'draft' | 'publish' | 'save';

interface ProductFormDialogProps {
  open: boolean;
  product: AdminProduct | null;
  categories: AdminCategory[];
  onClose: () => void;
  /** Retourne un message d'erreur, ou `null` si l'enregistrement a réussi. */
  onSubmit: (values: ProductFormValues, intent: SubmitIntent) => Promise<string | null>;
}

export function ProductFormDialog({ open, product, categories, onClose, onSubmit }: ProductFormDialogProps) {
  const [form, setForm] = useState<ProductFormInput>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(fromProduct(product));
      setErrors({});
      setFormError(null);
      setPending(false);
      setUploading(false);
    }
  }, [open, product]);

  const set = (key: keyof ProductFormInput) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(intent: SubmitIntent) {
    if (pending || uploading) return;
    const parsed = productFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ProductFormInput;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    const message = await onSubmit(parsed.data, intent);
    setPending(false);
    if (message) setFormError(message);
  }

  const editing = product !== null;
  const isPublished = product?.published === true;
  const activeCategories = categories.filter((category) => category.active || category.id === form.categoryId);
  const imagePreview = /^https:\/\/\S+$/.test(form.imageUrl.trim()) ? form.imageUrl.trim() : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && !uploading && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Modifier le produit' : 'Ajouter un produit'}</DialogTitle>
          <DialogDescription>
            Le stock se gère dans la section Stocks. Un brouillon n’est pas visible dans la boutique.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit(editing ? 'save' : 'draft');
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="product-name">Nom du produit *</Label>
            <Input id="product-name" value={form.name} onChange={(e) => set('name')(e.target.value)} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-description">Description</Label>
            <Textarea id="product-description" rows={4} value={form.description} onChange={(e) => set('description')(e.target.value)} />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="product-price">Prix (FCFA) *</Label>
              <Input id="product-price" inputMode="numeric" value={form.price} onChange={(e) => set('price')(e.target.value)} aria-invalid={!!errors.price} />
              {errors.price && <p className="text-sm text-destructive">{errors.price}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-category">Catégorie *</Label>
              <Select value={form.categoryId} onValueChange={set('categoryId')}>
                <SelectTrigger id="product-category" aria-invalid={!!errors.categoryId}>
                  <SelectValue placeholder="Choisir une catégorie" />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.categoryId && <p className="text-sm text-destructive">{errors.categoryId}</p>}
              {activeCategories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucune catégorie active. <Link href="/admin/categories" className="underline">Créez et activez une catégorie</Link> d’abord.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-image">Adresse de l’image (https://)</Label>
            <Input id="product-image" type="url" placeholder="https://…" value={form.imageUrl} onChange={(e) => set('imageUrl')(e.target.value)} aria-invalid={!!errors.imageUrl} />
            {errors.imageUrl && <p className="text-sm text-destructive">{errors.imageUrl}</p>}
            {imagePreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagePreview} alt="Aperçu du produit" className="mt-2 h-28 w-28 rounded-md border object-cover" />
            )}
          </div>

          <div className="space-y-1.5 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Depuis l’appareil</p>
            <ImagePicker onUploaded={set('imageUrl')} onCleared={() => set('imageUrl')(product?.imageUrls[0] ?? '')} onBusyChange={setUploading} />
            <p className="text-xs text-muted-foreground">
              Vous pouvez aussi coller une adresse https:// ci-dessus. Une image envoyée remplace l’adresse actuelle et l’ancien fichier n’est pas supprimé.
            </p>
          </div>

          {formError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={pending || uploading} onClick={onClose}>
              Annuler
            </Button>
            {isPublished ? (
              <Button type="button" disabled={pending || uploading} onClick={() => void submit('save')}>
                {pending ? 'Enregistrement…' : uploading ? 'Envoi de l’image…' : 'Enregistrer'}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={pending || uploading} onClick={() => void submit(editing ? 'save' : 'draft')}>
                  {editing ? 'Enregistrer le brouillon' : 'Enregistrer comme brouillon'}
                </Button>
                <Button type="button" disabled={pending || uploading} onClick={() => void submit('publish')}>
                  {pending ? 'Enregistrement…' : uploading ? 'Envoi de l’image…' : 'Publier'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
