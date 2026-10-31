'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { EmptyState, SectionHeader, StatCard } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PAYMENT_LABELS, STATUS_LABELS } from '@/components/admin/sections/orders-section';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { fetchOrders, fetchOverview, fetchStock, type Metric } from '@/lib/admin/queries';
import { formatPrice } from '@/lib/products';

const countNote = 'Source : base Meritt Home.';

function ModuleLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

export function OverviewSection() {
  const load = useCallback(fetchOverview, []);
  const { state } = useAdminQuery(load);
  const orders = useAdminQuery(fetchOrders);
  const stock = useAdminQuery(fetchStock);
  // fetchOverview ne lève pas d'erreur : chaque indicateur porte son propre état (valeur ou code d'erreur).
  const data = state.status === 'ready' ? state.data : null;
  const metric = (key: keyof NonNullable<typeof data>): Metric | null => (data ? data[key] : null);

  const recent = orders.state.status === 'ready' ? orders.state.data.orders.slice(0, 5) : [];

  const stockSummary =
    stock.state.status === 'ready'
      ? {
          total: stock.state.data.length,
          withQuantity: stock.state.data.filter((row) => row.quantity !== null).length,
          zero: stock.state.data.filter((row) => row.quantity === 0).length,
        }
      : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Vue d’ensemble"
        description="Indicateurs calculés à partir des données réelles de la base. Aucune valeur n’est estimée ni simulée."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Produits" metric={metric('products')} note={`${countNote} Tous statuts confondus.`} />
        <StatCard label="Produits publiés" metric={metric('publishedProducts')} note={`${countNote} Visibles dans la boutique.`} />
        <StatCard label="Catégories" metric={metric('categories')} note={countNote} />
        <StatCard label="Catégories actives" metric={metric('activeCategories')} note={countNote} />
        <StatCard label="Commandes enregistrées" metric={metric('orders')} note={countNote} />
        <StatCard label="Commandes en attente" metric={metric('pendingOrders')} note="Statut « pending »." />
        <StatCard
          label="Chiffre d’affaires encaissé"
          metric={metric('revenue')}
          format={formatPrice}
          note="Somme du total des commandes dont le paiement est confirmé (« paid »)."
        />
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Stocks</p>
          {stock.state.status === 'loading' && <Skeleton className="mt-2 h-9 w-24" />}
          {stock.state.status === 'error' && (
            <p className="mt-1 text-sm text-muted-foreground">Indisponible{stock.state.code ? ` (code ${stock.state.code})` : ''}</p>
          )}
          {stockSummary && (
            <>
              <p className="mt-1 font-display text-3xl font-semibold">{stockSummary.withQuantity}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                produit(s) avec une quantité renseignée sur {stockSummary.total} ; {stockSummary.zero} à zéro.
              </p>
            </>
          )}
        </div>
      </div>

      <nav aria-label="Accès rapide" className="flex flex-wrap gap-x-6 gap-y-2">
        <ModuleLink href="/admin/produits" label="Gérer les produits" />
        <ModuleLink href="/admin/categories" label="Gérer les catégories" />
        <ModuleLink href="/admin/stocks" label="Voir les stocks" />
        <ModuleLink href="/admin/commandes" label="Voir les commandes" />
      </nav>

      <section aria-labelledby="recent-orders" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 id="recent-orders" className="font-sans text-base font-semibold">
            Commandes récentes
          </h3>
          <ModuleLink href="/admin/commandes" label="Toutes les commandes" />
        </div>
        {orders.state.status === 'loading' && <Skeleton className="h-20 w-full" />}
        {orders.state.status === 'error' && (
          <p role="alert" className="text-sm text-muted-foreground">
            Commandes indisponibles{orders.state.code ? ` (code ${orders.state.code})` : ''}.
          </p>
        )}
        {orders.state.status === 'ready' &&
          (recent.length === 0 ? (
            <EmptyState title="Aucune commande enregistrée" text="Les commandes apparaîtront ici lorsque l’enregistrement des commandes sera en place." />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {recent.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="font-medium">{order.reference}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary">{STATUS_LABELS[order.status] ?? order.status}</Badge>
                    <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'outline'}>{PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}</Badge>
                    <span>{formatPrice(order.total)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
