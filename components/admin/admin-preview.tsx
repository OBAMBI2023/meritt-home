'use client';

import { useState } from 'react';
import { ArrowLeft, ClipboardList, LayoutDashboard, Menu, PackageCheck, Plus, ShieldAlert, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BrandLogo } from '@/components/shop/brand-logo';
import type { CatalogueState } from '@/hooks/use-catalogue';
import { countByCategory, formatPrice, getCategory, type Category, type Product } from '@/lib/products';
import { cn } from '@/lib/utils';

type ModuleId = 'overview' | 'products' | 'categories' | 'orders';

const MODULES: { id: ModuleId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { id: 'products', label: 'Produits', icon: PackageCheck },
  { id: 'categories', label: 'Catégories', icon: Tags },
  { id: 'orders', label: 'Commandes', icon: ClipboardList },
];

const UNAVAILABLE = 'Disponible après connexion à un backend';

function AdminNav({ active, onSelect }: { active: ModuleId; onSelect: (id: ModuleId) => void }) {
  return (
    <nav aria-label="Administration" className="space-y-1">
      {MODULES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
            active === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <ClipboardList className="h-7 w-7 text-muted-foreground" aria-hidden />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** Données du catalogue public (produits publiés, catégories actives), telles que lues par la boutique. */
interface CatalogueData {
  state: CatalogueState;
  products: Product[];
  categories: Category[];
}

const statValue = (data: CatalogueData, count: number) =>
  data.state.status === 'ready' ? String(count) : data.state.status === 'loading' ? '…' : '—';

const statNote = (data: CatalogueData) =>
  data.state.status === 'error' ? 'Catalogue indisponible' : 'Source : catalogue public Supabase (publiés)';

function Overview({ data }: { data: CatalogueData }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Produits publiés" value={statValue(data, data.products.length)} note={statNote(data)} />
        <Stat label="Catégories actives" value={statValue(data, data.categories.length)} note={statNote(data)} />
        <Stat label="Commandes" value="—" note="Aucune source de données connectée" />
        <Stat label="Chiffre d’affaires" value="—" note="Aucune source de données connectée" />
      </div>
      <section aria-labelledby="orders-title" className="space-y-3">
        <h3 id="orders-title" className="font-sans text-base font-semibold">
          Dernières commandes
        </h3>
        <EmptyState
          title="Aucune commande à afficher"
          text="Les commandes apparaîtront ici lorsque l’enregistrement des commandes sera en place."
        />
      </section>
    </div>
  );
}

function CatalogueUnavailable({ data, emptyTitle, emptyText }: { data: CatalogueData; emptyTitle: string; emptyText: string }) {
  if (data.state.status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Chargement du catalogue…</p>;
  if (data.state.status === 'error') return <EmptyState title="Catalogue indisponible" text="La lecture du catalogue a échoué. Rechargez la page pour réessayer." />;
  return <EmptyState title={emptyTitle} text={emptyText} />;
}

function ProductsModule({ data }: { data: CatalogueData }) {
  if (data.state.status !== 'ready' || data.products.length === 0) {
    return <CatalogueUnavailable data={data} emptyTitle="Aucun produit publié" emptyText="Les produits publiés apparaîtront ici." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Lecture seule, produits publiés uniquement. La création, la modification et la suppression nécessiteront l’authentification administrateur.
        </p>
        <Button type="button" disabled title={UNAVAILABLE}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Ajouter un produit
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead className="text-right">Prix</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>{getCategory(data.categories, product.categoryId)?.name ?? '—'}</TableCell>
                <TableCell className="text-right">{formatPrice(product.price)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CategoriesModule({ data }: { data: CatalogueData }) {
  if (data.state.status !== 'ready' || data.categories.length === 0) {
    return <CatalogueUnavailable data={data} emptyTitle="Aucune catégorie active" emptyText="Les catégories actives apparaîtront ici." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Lecture seule, catégories actives uniquement. Le nombre de produits publiés est calculé depuis le catalogue.</p>
        <Button type="button" disabled title={UNAVAILABLE}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Ajouter une catégorie
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Catégorie</TableHead>
              <TableHead className="text-right">Produits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">{category.name}</TableCell>
                <TableCell className="text-right">{countByCategory(data.products, category.id)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function OrdersModule() {
  return (
    <EmptyState
      title="Aucune commande"
      text="La liste et le suivi des commandes seront disponibles lorsque les commandes seront enregistrées par un backend."
    />
  );
}

interface AdminPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogue: CatalogueData;
}

/**
 * Aperçu de l'interface d'administration. Aucune authentification, aucune écriture :
 * il n'affiche que des données issues du catalogue public (lecture seule) et des états vides.
 */
export function AdminPreview({ open, onOpenChange, catalogue }: AdminPreviewProps) {
  const [module, setModule] = useState<ModuleId>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const current = MODULES.find((item) => item.id === module) ?? MODULES[0];

  const select = (id: ModuleId) => {
    setModule(id);
    setMenuOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-none w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 bg-muted/40 p-0 sm:rounded-none [&>button:last-child]:hidden">
        <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-card p-5 md:flex">
          <div className="space-y-1">
            <BrandLogo />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Administration</p>
          </div>
          <AdminNav active={module} onSelect={select} />
          <DialogClose asChild>
            <Button type="button" variant="outline" className="mt-auto">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Retour à la boutique
            </Button>
          </DialogClose>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b bg-card px-4 py-3 sm:px-6">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Ouvrir le menu d’administration"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-display text-xl font-semibold">{current.label}</DialogTitle>
              <DialogDescription className="sr-only">Aperçu de l’interface d’administration Meritt Home</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="md:hidden">
                Boutique
              </Button>
            </DialogClose>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
            <div role="note" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <p>
                <strong>Aperçu non sécurisé.</strong> Cette interface n’est protégée par aucune authentification et n’enregistre aucune donnée.
                L’accès sera réservé aux administrateurs lors de la mise en place du backend.
              </p>
            </div>

            {module === 'overview' && <Overview data={catalogue} />}
            {module === 'products' && <ProductsModule data={catalogue} />}
            {module === 'categories' && <CategoriesModule data={catalogue} />}
            {module === 'orders' && <OrdersModule />}
          </div>
        </div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-72 space-y-6 p-5">
            <div className="space-y-1">
              <SheetTitle className="sr-only">Menu d’administration</SheetTitle>
              <SheetDescription className="sr-only">Navigation entre les modules d’administration</SheetDescription>
              <BrandLogo />
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Administration</p>
            </div>
            <AdminNav active={module} onSelect={select} />
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}
