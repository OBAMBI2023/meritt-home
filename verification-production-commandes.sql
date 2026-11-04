-- Meritt Home — Vérification en LECTURE SEULE du parcours de commande (à coller dans le SQL Editor de la PRODUCTION).
-- Ne contient que des SELECT : aucune écriture, aucune migration. Aucune donnée client n'est lue (comptages et indicateurs uniquement).
-- Exécution : à lancer par vous, un bloc à la fois. Avant de cliquer sur Run, vérifiez le projet affiché (jvmvsaiduralhezrjeyg).
-- Attendu : voir la colonne « attendu » ; les lignes marquées « INFO » ne sont pas des pass/fail.

-- ===== BLOC 1 — Schéma des commandes (attendu : toutes les lignes ok = true)
select 'table orders'                      as controle, to_regclass('public.orders') is not null as ok
union all select 'table order_items',        to_regclass('public.order_items') is not null
union all select 'table order_settings',     to_regclass('public.order_settings') is not null
union all select 'table delivery_fees',      to_regclass('public.delivery_fees') is not null
union all select 'table product_inventory',  to_regclass('public.product_inventory') is not null
union all select 'orders : colonnes de la migration commandes',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders'
     and column_name in ('fulfillment_method', 'idempotency_key', 'customer_phone_digits', 'stock_restored_at', 'payment_method', 'payment_status')) = 6
union all select 'order_items : colonne stock_decremented',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'stock_decremented')
union all select 'index unique sur idempotency_key',
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'orders' and indexname = 'orders_idempotency_key_key');

-- ===== BLOC 2 — Fonctions (attendu : les 4 fonctions existent, create_order en 10 arguments)
select p.proname as fonction,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as executable_par_anon
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('create_order', 'order_summary', 'get_checkout_config', 'admin_set_order_status', 'get_catalogue_availability')
order by p.proname;
-- Attendu : create_order = oui/oui ; get_checkout_config = oui/oui ; order_summary et admin_set_order_status = non pour anon ;
--           get_catalogue_availability ABSENTE (migration du stock hybride non encore appliquée).

-- ===== BLOC 3 — Version de create_order en production (INFO : indique si le stock hybride est déjà présent)
select (pg_get_functiondef(p.oid) like '%inventory_mode%') as create_order_hybride,
       (pg_get_functiondef(p.oid) like '%STOCK_UNTRACKED%') as gere_stock_non_suivi,
       (pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%') as idempotence_verrouillee
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order';
-- Attendu avant migration hybride : false / true / true.

-- ===== BLOC 4 — Colonnes du stock hybride (attendu avant migration : 0 sur products, 0 sur order_items)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'products'
          and column_name in ('inventory_mode', 'availability_status', 'lead_time')) as colonnes_products,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'order_items'
          and column_name in ('inventory_mode', 'lead_time')) as colonnes_order_items;

-- ===== BLOC 5 — Paramètres de commande (attendu : 1 ligne ; politique 'reject' ; limites > 0). Aucune donnée personnelle.
select count(*) over () as nb_lignes, untracked_stock_policy, max_orders_per_phone_per_hour, max_orders_per_phone_per_day
from public.order_settings;

-- ===== BLOC 6 — Grille de livraison (attendu : au moins une commune active avec un tarif réel)
select count(*) filter (where is_active) as communes_actives, count(*) as communes_total,
       min(fee_fcfa) filter (where is_active) as tarif_min, max(fee_fcfa) filter (where is_active) as tarif_max
from public.delivery_fees;

-- ===== BLOC 7 — Politiques d'accès (attendu : aucune politique permettant à anon de lire ou écrire orders / order_items)
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('orders', 'order_items', 'order_settings', 'delivery_fees', 'product_inventory')
order by tablename, policyname;

select 'RLS activée sur ' || c.relname as controle, c.relrowsecurity as ok
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relname in ('orders', 'order_items', 'order_settings', 'delivery_fees', 'product_inventory')
order by c.relname;

-- ===== BLOC 8 — Catalogue publié et stock (comptages seulement ; INFO pour décider du mode de chaque produit)
select count(*) filter (where p.is_published) as produits_publies,
       count(*) filter (where p.is_published and i.product_id is null) as publies_sans_ligne_de_stock,
       count(*) filter (where p.is_published and i.stock_quantity is null) as publies_stock_non_renseigne,
       count(*) filter (where p.is_published and i.stock_quantity = 0) as publies_stock_zero,
       count(*) filter (where p.is_published and i.stock_quantity > 0) as publies_en_stock
from public.products p
left join public.product_inventory i on i.product_id = p.id;

-- Liste des produits publiés qui ne pourraient PAS être commandés aujourd'hui (nom, prix, état du stock). Aucune donnée client.
select p.name, p.price_fcfa,
       case when i.product_id is null then 'aucune ligne de stock'
            when i.stock_quantity is null then 'quantité non renseignée'
            when i.stock_quantity = 0 then 'quantité 0' end as raison
from public.products p
left join public.product_inventory i on i.product_id = p.id
where p.is_published and (i.product_id is null or i.stock_quantity is null or i.stock_quantity = 0)
order by p.name;

-- ===== BLOC 9 — Commandes existantes (comptages par statut seulement, sans nom ni téléphone)
select status, payment_method, payment_status, count(*) as nombre
from public.orders
group by 1, 2, 3
order by 1, 2, 3;
-- Attendu : paiement = cash_on_delivery / pending ; aucune commande 'paid' sans encaissement connu.

-- ===== BLOC 10 — Cohérence du stock restitué (attendu : 0 ligne incohérente)
select count(*) as commandes_annulees_sans_restitution
from public.orders
where status = 'cancelled' and stock_restored_at is null;
