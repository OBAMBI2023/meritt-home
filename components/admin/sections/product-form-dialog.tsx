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
import { outOfStockConflict, productFormSchema, type ProductFormInput, type ProductFormValues } from '@/lib/admin/products';

type FieldErrors = Partial<Record<keyof ProductFormInput, string>>;

const emptyForm: ProductFormInput = {
  name: '',
  description: '',
  price: '',
  categoryId: '',
  imageUrl: '',
  inventoryMode: 'tracked',
  availability: 'available',
  leadTime: '',
  quantity: '',
};

type AvailabilityChoice = 'tracked' | 'on_demand' | 'unavailable';

const CHOICES: { value: AvailabilityChoice; label: string; hint: string }[] = [
  { value: 'tracked', label: 'Gestion du stock', hint: 'Commandable tant que la quantité le permet ; le stock est décrémenté à chaque commande.' },
  { value: 'on_demand', label: 'Sur commande', hint: 'Commandable sans quantité ; le stock n’est jamais décrémenté.' },
  { value: 'unavailable', label: 'Indisponible', hint: 'Visible dans la boutique, mais impossible à ajouter au panier ou à commander.' },
];

function fromProduct(product: AdminProduct | null): ProductFormInput {
  if (!product) return emptyForm;
  return {
    name: product.name,
    description: product.description ?? '',
    price: String(product.price),
    categoryId: product.categoryId ?? '',
    imageUrl: product.imageUrls[0] ?? '',
    inventoryMode: product.inventoryMode,
    availability: product.availability,
    leadTime: product.leadTime ?? '',
    quantity: typeof product.quantity === 'number' ? String(product.quantity) : '',
  };
}

export type SubmitIntent = 'draft' | 'publish' | 'save';

interface ProductFormDialogProps {
  open: boolean;
  product: AdminProduct | null;
  categories: AdminCategory[];
  /** Les colonnes du stock hybride existent en base : sinon le sélecteur de disponibilité n'est pas proposé. */
  hybrid: boolean;
  onClose: () => void;
  /** Retourne un message d'erreur, ou `null` si l'enregistrement a réussi. */
  onSubmit: (values: ProductFormValues, intent: SubmitIntent) => Promise<string | null>;
}

export function ProductFormDialog({ open, product, categories, hybrid, onClose, onSubmit }: ProductFormDialogProps) {
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

  const choice: AvailabilityChoice = form.availability === 'unavailable' ? 'unavailable' : form.inventoryMode;
  /** « Indisponible » ne change pas le mode de gestion : repasser en « Gestion du stock » ou « Sur commande » le retrouve. */
  const pickChoice = (value: AvailabilityChoice) =>
    setForm((current) => (value === 'unavailable' ? { ...current, availability: 'unavailable' } : { ...current, availability: 'available', inventoryMode: value }));

  async function submit(intent: SubmitIntent) {
    if (pending || uploading) return;
    const parsed = productFormSchema.safeParse(form);
    // Un produit suivi ne se publie pas sans quantité : il serait affiché « Épuisé » et refusé à la commande.
    if (parsed.success && hybrid && intent === 'publish' && choice === 'tracked' && parsed.data.quantity === '' && typeof product?.quantity !== 'number') {
      setErrors({ quantity: 'Saisissez la quantité en stock, ou choisissez « Sur commande ».' });
      return;
    }
    // Rupture avec stock positif : refus avant toute écriture (la quantité saisie remplace l'actuelle pour un produit suivi).
    if (parsed.success && hybrid) {
      const effective = parsed.data.inventoryMode === 'tracked' && parsed.data.quantity !== '' ? Number(parsed.data.quantity) : product?.quantity;
      const conflict = outOfStockConflict(parsed.data.availability, parsed.data.inventoryMode, effective, 'fiche');
      if (conflict) {
        setErrors({ availability: conflict });
        return;
      }
    }
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

          {hybrid && (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Disponibilité *</legend>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Disponibilité">
                {CHOICES.map((item) => (
                  <label key={item.value} className="relative block cursor-pointer">
                    <input type="radio" name="availability" value={item.value} checked={choice === item.value} onChange={() => pickChoice(item.value)} className="peer sr-only" />
                    <span className="flex min-h-[2.75rem] items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-medium transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{CHOICES.find((item) => item.value === choice)?.hint}</p>

              {errors.availability && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                  {errors.availability}
                </p>
              )}

              {choice === 'unavailable' && (
                <p className="text-xs text-muted-foreground">
                  Mode de gestion conservé : {form.inventoryMode === 'on_demand' ? 'sur commande' : 'gestion du stock'}.
                  {form.inventoryMode === 'tracked' ? ' La quantité doit être à 0 pour enregistrer un produit en rupture.' : ''}
                </p>
              )}

              {(choice === 'tracked' || (choice === 'unavailable' && form.inventoryMode === 'tracked')) && (
                <div className="space-y-1.5">
                  <Label htmlFor="product-quantity">Quantité en stock</Label>
                  <Input id="product-quantity" inputMode="numeric" className="max-w-[10rem]" value={form.quantity} onChange={(e) => set('quantity')(e.target.value)} aria-invalid={!!errors.quantity} />
                  {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
                  <p className="text-xs text-muted-foreground">
                    {typeof product?.quantity === 'number'
                      ? `Quantité actuelle : ${product.quantity}. La valeur saisie la remplace (la quantité reste aussi modifiable dans Stocks).`
                      : 'Sans quantité, le produit est affiché « Épuisé » et ne peut pas être commandé.'}
                  </p>
                </div>
              )}

              {choice === 'on_demand' && (
                <div className="space-y-1.5">
                  <Label htmlFor="product-lead-time">Délai d’approvisionnement (facultatif)</Label>
                  <Input id="product-lead-time" placeholder="Par exemple : 2 à 3 semaines" value={form.leadTime} onChange={(e) => set('leadTime')(e.target.value)} aria-invalid={!!errors.leadTime} maxLength={80} />
                  {errors.leadTime && <p className="text-sm text-destructive">{errors.leadTime}</p>}
                  <p className="text-xs text-muted-foreground">Affiché aux clients seulement s’il est renseigné. La quantité éventuellement saisie plus tôt est conservée, sans effet.</p>
                </div>
              )}
            </fieldset>
          )}

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
