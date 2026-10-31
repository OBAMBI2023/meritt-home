-- =====================================================================
-- MERITT HOME — Système de commande réel : migration additive (PROPOSITION)
-- Projet Supabase : jvmvsaiduralhezrjeyg
--
-- STATUT : NON APPLIQUÉE, NON EXÉCUTÉE. À relire puis à appliquer manuellement.
-- Généré à partir de l'audit réel du schéma (29/10/2026) : orders=0, order_items=0,
-- products=1, product_inventory=0, categories=1, admin_users=1.
--
-- Contenu :
--   PARTIE 0 — Contrôles préalables (lecture seule)
--   PARTIE 1 — Migration (une transaction)
--   PARTIE 2 — Vérifications après application (lecture seule)
--   PARTIE 3 — Scénarios de test (écrivent puis ANNULENT automatiquement)
--   PARTIE 4 — Retour arrière
-- Exécutez chaque partie séparément dans l'éditeur SQL.
-- =====================================================================


-- =====================================================================
-- PARTIE 0 — CONTRÔLES PRÉALABLES (lecture seule)
-- Résultat attendu : toutes les lignes "ok" = true.
-- =====================================================================
select 'orders vide'                       as controle, (select count(*) from public.orders) = 0 as ok
union all select 'order_items vide',          (select count(*) from public.order_items) = 0
union all select 'is_admin() existe',         exists (select 1 from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace)
union all select 'set_updated_at() existe',   exists (select 1 from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace)
union all select 'orders_status_check existe',exists (select 1 from pg_constraint where conname = 'orders_status_check')
union all select 'politique clients orders',  exists (select 1 from pg_policies where policyname = 'Customers read own orders' and tablename = 'orders')
union all select 'politique clients items',   exists (select 1 from pg_policies where policyname = 'Customers read own order items' and tablename = 'order_items')
union all select 'colonne fulfillment_method absente', not exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='fulfillment_method')
union all select 'tables de config absentes', not exists (select 1 from information_schema.tables where table_schema='public' and table_name in ('order_settings','delivery_fees'));


-- =====================================================================
-- PARTIE 1 — MIGRATION
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1.1 Paramètres de commande (une seule ligne).
--     DÉCISIONS À CONFIRMER (voir le rapport) :
--       untracked_stock_policy : 'reject' (par défaut, prudent) refuse de vendre un produit
--         sans quantité suivie (aucune ligne product_inventory, OU stock_quantity NULL).
--         'allow' le vend sans rien décrémenter. Le sens de NULL n'est pas déduit du schéma.
--       limites par téléphone : 3 commandes/heure et 10/jour (valeurs modifiables).
--       pickup_address : NULL tant que l'adresse officielle n'est pas confirmée.
-- ---------------------------------------------------------------------
create table public.order_settings (
  id                            boolean primary key default true check (id),
  untracked_stock_policy        text    not null default 'reject' check (untracked_stock_policy in ('reject', 'allow')),
  max_orders_per_phone_per_hour int4    not null default 3  check (max_orders_per_phone_per_hour >= 1),
  max_orders_per_phone_per_day  int4    not null default 10 check (max_orders_per_phone_per_day >= 1),
  pickup_address                text,
  updated_at                    timestamptz not null default now()
);
-- Durcissement : aucun droit par défaut pour le rôle anonyme sur cette table.
revoke all on public.order_settings from anon;
insert into public.order_settings (id) values (true);

create trigger order_settings_set_updated_at
  before update on public.order_settings
  for each row execute function public.set_updated_at();

alter table public.order_settings enable row level security;
create policy "Admins manage order settings" on public.order_settings
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, update on public.order_settings to authenticated;

-- ---------------------------------------------------------------------
-- 1.2 Grille des frais de livraison par commune.
--     VIDE À DESSEIN : aucun tarif n'est inventé. Une livraison est refusée
--     (NO_DELIVERY_FEE) tant que la commune n'a pas de tarif actif.
-- ---------------------------------------------------------------------
create table public.delivery_fees (
  commune     text primary key check (char_length(btrim(commune)) between 2 and 80),
  fee_fcfa    int4 not null check (fee_fcfa >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Durcissement : aucun droit par défaut pour le rôle anonyme sur cette table.
revoke all on public.delivery_fees from anon;

create trigger delivery_fees_set_updated_at
  before update on public.delivery_fees
  for each row execute function public.set_updated_at();

alter table public.delivery_fees enable row level security;
create policy "Admins manage delivery fees" on public.delivery_fees
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.delivery_fees to authenticated;

-- ---------------------------------------------------------------------
-- 1.3 Colonnes ajoutées à orders / order_items
-- ---------------------------------------------------------------------
alter table public.orders
  add column fulfillment_method     text not null default 'delivery'
    constraint orders_fulfillment_method_check check (fulfillment_method in ('delivery', 'pickup')),
  add column idempotency_key        uuid,
  add column customer_phone_digits  text,
  add column stock_restored_at      timestamptz;

create unique index orders_idempotency_key_key on public.orders (idempotency_key) where idempotency_key is not null;
create index orders_phone_created_idx on public.orders (customer_phone_digits, created_at desc);

-- Le retrait n'a ni adresse ni commune : on lève NOT NULL mais on l'exige pour la livraison.
alter table public.orders
  alter column delivery_address drop not null,
  alter column delivery_commune drop not null;

alter table public.orders
  add constraint orders_delivery_fields_check check (
    fulfillment_method = 'pickup'
    or (nullif(btrim(delivery_address), '') is not null and nullif(btrim(delivery_commune), '') is not null)
  );

-- Statuts : ajout de 'ready_for_pickup'. 'shipped' = « en livraison », 'delivered' = « terminée » (valeurs existantes conservées).
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in ('pending', 'confirmed', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled')
);
alter table public.orders add constraint orders_status_fulfillment_check check (
  (status <> 'ready_for_pickup' or fulfillment_method = 'pickup')
  and (status <> 'shipped' or fulfillment_method = 'delivery')
);

-- Quantité réellement décrémentée par ligne : sert à restituer le stock exactement une fois.
alter table public.order_items
  add column stock_decremented int4 not null default 0
    constraint order_items_stock_decremented_check check (stock_decremented >= 0 and stock_decremented <= quantity);

-- ---------------------------------------------------------------------
-- 1.4 Politiques : les clients ne lisent plus les commandes directement.
--     Les politiques « Admins read all orders / order items » ne sont PAS touchées.
--     La confirmation de commande est renvoyée par create_order().
-- ---------------------------------------------------------------------
drop policy "Customers read own orders" on public.orders;
drop policy "Customers read own order items" on public.order_items;

-- ---------------------------------------------------------------------
-- 1.5 Résumé d'une commande (usage interne, non exposé aux rôles API)
-- ---------------------------------------------------------------------
create or replace function public.order_summary(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reference',          o.reference,
    'status',             o.status,
    'fulfillment_method', o.fulfillment_method,
    'payment_method',     o.payment_method,
    'payment_status',     o.payment_status,
    'customer_name',      o.customer_name,
    'delivery_commune',   o.delivery_commune,
    'delivery_address',   o.delivery_address,
    'pickup_address',     case when o.fulfillment_method = 'pickup' then (select s.pickup_address from public.order_settings s limit 1) end,
    'subtotal_fcfa',      o.subtotal_fcfa,
    'delivery_fee_fcfa',  o.delivery_fee_fcfa,
    'total_fcfa',         o.total_fcfa,
    'created_at',         o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_name', oi.product_name,
               'unit_price_fcfa', oi.unit_price_fcfa,
               'quantity', oi.quantity,
               'line_total_fcfa', oi.line_total_fcfa)
             order by oi.created_at, oi.id)
      from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;
revoke all on function public.order_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.6 Configuration publique du tunnel de commande (frais actifs + adresse de retrait)
-- ---------------------------------------------------------------------
create or replace function public.get_checkout_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'fees', coalesce((select jsonb_agg(jsonb_build_object('commune', f.commune, 'fee_fcfa', f.fee_fcfa) order by f.commune)
                      from public.delivery_fees f where f.is_active), '[]'::jsonb),
    'pickup_address', (select s.pickup_address from public.order_settings s limit 1)
  );
$$;
revoke all on function public.get_checkout_config() from public;
grant execute on function public.get_checkout_config() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.7 create_order : création atomique d'une commande (appelable sans compte)
--     Codes d'erreur renvoyés dans error.message :
--       REQUEST_REJECTED, INVALID_REQUEST, INVALID_CUSTOMER, INVALID_PHONE, INVALID_ITEMS,
--       INVALID_FULFILLMENT, INVALID_ADDRESS, RATE_LIMITED, PRODUCT_UNAVAILABLE,
--       STOCK_UNTRACKED, INSUFFICIENT_STOCK, NO_DELIVERY_FEE, AMOUNT_TOO_LARGE
--     Prix, frais, totaux, disponibilité : recalculés ici, jamais lus depuis le navigateur.
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_idempotency_key    uuid,
  p_customer_name      text,
  p_customer_email     text,
  p_customer_phone     text,
  p_fulfillment_method text,
  p_delivery_commune   text,
  p_delivery_address   text,
  p_customer_notes     text,
  p_items              jsonb,
  p_website            text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings  public.order_settings%rowtype;
  v_existing  uuid;
  v_order_id  uuid;
  v_name      text := btrim(coalesce(p_customer_name, ''));
  v_email     text := lower(btrim(coalesce(p_customer_email, '')));
  v_digits    text := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  v_commune   text := btrim(coalesce(p_delivery_commune, ''));
  v_address   text := btrim(coalesce(p_delivery_address, ''));
  v_notes     text := nullif(btrim(coalesce(p_customer_notes, '')), '');
  v_fee       int4 := 0;
  v_subtotal  int8 := 0;
  v_lines     jsonb := '[]'::jsonb;
  v_dec       int4;
  v_row       record;
  v_elem      jsonb;
  v_uuid_re   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- Honeypot : un champ caché rempli = robot. Refus explicite (pas de faux succès).
  if btrim(coalesce(p_website, '')) <> '' then
    raise exception 'REQUEST_REJECTED';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_REQUEST';
  end if;

  -- Idempotence : deux appels simultanés avec la même clé sont sérialisés.
  perform pg_advisory_xact_lock(hashtextextended('mh-order-key:' || p_idempotency_key::text, 0));
  select o.id into v_existing from public.orders o where o.idempotency_key = p_idempotency_key;
  if found then
    return public.order_summary(v_existing) || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Validation des entrées
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'INVALID_CUSTOMER'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_CUSTOMER'; end if;
  if char_length(v_digits) = 13 and left(v_digits, 3) = '225' then v_digits := right(v_digits, 10); end if;
  if char_length(v_digits) <> 10 then raise exception 'INVALID_PHONE'; end if;
  if v_notes is not null and char_length(v_notes) > 500 then raise exception 'INVALID_CUSTOMER'; end if;
  if p_fulfillment_method not in ('delivery', 'pickup') then raise exception 'INVALID_FULFILLMENT'; end if;
  if p_fulfillment_method = 'delivery' then
    if char_length(v_address) < 5 or char_length(v_address) > 300 or char_length(v_commune) < 2 then raise exception 'INVALID_ADDRESS'; end if;
  else
    v_commune := null; v_address := null;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'INVALID_ITEMS';
  end if;
  for v_elem in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_elem) <> 'object'
       or coalesce(v_elem->>'product_id', '') !~ v_uuid_re
       or coalesce(v_elem->>'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'INVALID_ITEMS';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    group by (e->>'product_id')::uuid
    having sum((e->>'quantity')::int) not between 1 and 10
  ) then
    raise exception 'INVALID_ITEMS';
  end if;

  select * into v_settings from public.order_settings limit 1;

  -- Limitation par numéro de téléphone (sérialisée par numéro)
  perform pg_advisory_xact_lock(hashtextextended('mh-order-phone:' || v_digits, 0));
  if (select count(*) from public.orders o where o.customer_phone_digits = v_digits and o.created_at > now() - interval '1 hour') >= v_settings.max_orders_per_phone_per_hour
     or (select count(*) from public.orders o where o.customer_phone_digits = v_digits and o.created_at > now() - interval '1 day') >= v_settings.max_orders_per_phone_per_day then
    raise exception 'RATE_LIMITED';
  end if;

  -- Verrous (ordre déterministe par id) : produits en partage, inventaire en écriture
  perform 1 from public.products p
    where p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(p_items) e)
    order by p.id for share;
  perform 1 from public.product_inventory i
    where i.product_id in (select (e->>'product_id')::uuid from jsonb_array_elements(p_items) e)
    order by i.product_id for update;

  -- Lignes : produit publié dans une catégorie active, prix lu en base, stock contrôlé et décrémenté
  for v_row in
    with wanted as (
      select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::int)::int4 as qty
      from jsonb_array_elements(p_items) e
      group by 1
    )
    select w.product_id, w.qty, p.name, p.price_fcfa, (i.product_id is not null) as has_row, i.stock_quantity
    from wanted w
    left join public.products p
      on p.id = w.product_id
     and p.is_published
     and exists (select 1 from public.categories c where c.id = p.category_id and c.is_active)
    left join public.product_inventory i on i.product_id = w.product_id
    order by w.product_id
  loop
    if v_row.name is null then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;

    v_dec := 0;
    if v_row.has_row and v_row.stock_quantity is not null then
      update public.product_inventory
         set stock_quantity = stock_quantity - v_row.qty
       where product_id = v_row.product_id and stock_quantity >= v_row.qty;
      if not found then
        raise exception 'INSUFFICIENT_STOCK' using detail = v_row.name;
      end if;
      v_dec := v_row.qty;
    elsif v_settings.untracked_stock_policy <> 'allow' then
      raise exception 'STOCK_UNTRACKED' using detail = v_row.name;
    end if;

    v_subtotal := v_subtotal + v_row.price_fcfa::int8 * v_row.qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_row.product_id, 'name', v_row.name,
      'unit', v_row.price_fcfa, 'qty', v_row.qty, 'dec', v_dec));
  end loop;

  -- Frais de livraison : grille par commune, refus si aucun tarif actif
  if p_fulfillment_method = 'delivery' then
    select f.fee_fcfa into v_fee from public.delivery_fees f where f.commune = v_commune and f.is_active;
    if not found then
      raise exception 'NO_DELIVERY_FEE';
    end if;
  end if;

  if v_subtotal + v_fee > 2000000000 then
    raise exception 'AMOUNT_TOO_LARGE';
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_email, customer_phone, customer_phone_digits,
    delivery_address, delivery_commune, customer_notes,
    subtotal_fcfa, delivery_fee_fcfa, total_fcfa,
    fulfillment_method, idempotency_key,
    status, payment_method, payment_status)
  values (
    (select auth.uid()), v_name, v_email, btrim(p_customer_phone), v_digits,
    v_address, v_commune, v_notes,
    v_subtotal::int4, v_fee, (v_subtotal + v_fee)::int4,
    p_fulfillment_method, p_idempotency_key,
    'pending', 'cash_on_delivery', 'pending')
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, product_name, unit_price_fcfa, quantity, line_total_fcfa, stock_decremented)
  select v_order_id, (l->>'product_id')::uuid, l->>'name', (l->>'unit')::int4, (l->>'qty')::int4,
         (l->>'unit')::int4 * (l->>'qty')::int4, (l->>'dec')::int4
  from jsonb_array_elements(v_lines) l;

  return public.order_summary(v_order_id);
end;
$$;
revoke all on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.8 admin_set_order_status : transitions autorisées + restitution unique du stock
--     Réservée aux administrateurs (is_admin()). Ne modifie JAMAIS payment_status :
--     aucune commande n'est marquée payée par cette migration.
--     Annulation autorisée : livraison → avant 'shipped' ; retrait → jusqu'à 'ready_for_pickup' inclus.
--     (À CONFIRMER : voir le rapport.)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders%rowtype;
  v_allowed text[];
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.fulfillment_method = 'delivery' then
    v_allowed := case v_order.status
      when 'pending'   then array['confirmed', 'cancelled']
      when 'confirmed' then array['preparing', 'cancelled']
      when 'preparing' then array['shipped', 'cancelled']
      when 'shipped'   then array['delivered']
      else array[]::text[] end;
  else
    v_allowed := case v_order.status
      when 'pending'          then array['confirmed', 'cancelled']
      when 'confirmed'        then array['preparing', 'cancelled']
      when 'preparing'        then array['ready_for_pickup', 'cancelled']
      when 'ready_for_pickup' then array['delivered', 'cancelled']
      else array[]::text[] end;
  end if;

  if p_new_status is null or not (p_new_status = any (v_allowed)) then
    raise exception 'INVALID_TRANSITION' using detail = v_order.status || ' -> ' || coalesce(p_new_status, 'null');
  end if;

  if p_new_status = 'cancelled' then
    -- Restitution unique : garde stock_restored_at + statut terminal 'cancelled' (aucune transition ne repart de là).
    if v_order.stock_restored_at is null then
      update public.product_inventory i
         set stock_quantity = i.stock_quantity + r.qty
        from (
          select oi.product_id, sum(oi.stock_decremented)::int4 as qty
          from public.order_items oi
          where oi.order_id = v_order.id and oi.product_id is not null and oi.stock_decremented > 0
          group by oi.product_id
        ) r
       where i.product_id = r.product_id and i.stock_quantity is not null;
    end if;
    update public.orders set status = 'cancelled', stock_restored_at = coalesce(stock_restored_at, now()) where id = v_order.id;
  else
    update public.orders set status = p_new_status where id = v_order.id;
  end if;

  return public.order_summary(v_order.id);
end;
$$;
revoke all on function public.admin_set_order_status(uuid, text) from public, anon;
grant execute on function public.admin_set_order_status(uuid, text) to authenticated;

commit;


-- =====================================================================
-- PARTIE 2 — VÉRIFICATIONS APRÈS APPLICATION (lecture seule)
-- Résultat attendu : toutes les lignes ok = true.
-- =====================================================================
select 'create_order: anon peut exécuter'      as controle, has_function_privilege('anon', 'public.create_order(uuid,text,text,text,text,text,text,text,jsonb,text)', 'execute') as ok
union all select 'create_order: search_path fixé', exists (select 1 from pg_proc where proname='create_order' and prosecdef and proconfig::text like '%search_path%')
union all select 'admin_set_order_status: anon NON', not has_function_privilege('anon', 'public.admin_set_order_status(uuid,text)', 'execute')
union all select 'admin_set_order_status: authenticated oui', has_function_privilege('authenticated', 'public.admin_set_order_status(uuid,text)', 'execute')
union all select 'order_summary: anon NON',        not has_function_privilege('anon', 'public.order_summary(uuid)', 'execute')
union all select 'order_summary: authenticated NON', not has_function_privilege('authenticated', 'public.order_summary(uuid)', 'execute')
union all select 'politiques clients supprimées',  not exists (select 1 from pg_policies where policyname in ('Customers read own orders','Customers read own order items'))
union all select 'politiques admin conservées',    (select count(*) from pg_policies where policyname in ('Admins read all orders','Admins read all order items','Admins update order status')) = 3
union all select 'RLS actif partout',              (select bool_and(relrowsecurity) from pg_class where relnamespace='public'::regnamespace and relkind='r')
union all select 'delivery_fees vide (aucun tarif inventé)', (select count(*) from public.delivery_fees) = 0
union all select 'pickup_address NULL (non confirmée)',        (select pickup_address is null from public.order_settings)
union all select 'anon sans accès aux commandes',  not has_table_privilege('anon', 'public.orders', 'select')
union all select 'statuts: ready_for_pickup accepté', (select pg_get_constraintdef(oid) like '%ready_for_pickup%' from pg_constraint where conname='orders_status_check');


-- =====================================================================
-- PARTIE 3 — SCÉNARIOS DE TEST (tout est ANNULÉ automatiquement)
-- Le bloc se termine volontairement par une ERREUR "RESULTATS DES TESTS" : PostgreSQL annule alors
-- toute la transaction (tarif, stock et commandes de test compris). L'éditeur SQL n'affiche pas les
-- NOTICE : le rapport est donc placé dans le message d'erreur. Chaque ligne doit finir par OK.
-- Si l'erreur est autre que "RESULTATS DES TESTS", copiez-la-moi : rien n'est conservé.
-- Prérequis : un produit publié dans une catégorie active (c'est le cas : 1 produit), 1 administrateur.
-- =====================================================================
do $$
declare
  v_pid    uuid := (select id from public.products where is_published limit 1);
  v_admin  uuid := (select user_id from public.admin_users limit 1);
  v_key    uuid := gen_random_uuid();
  v_two    jsonb;
  v_one    jsonb;
  r1 jsonb; r2 jsonb;
  v_stock  int;
  v_order  uuid;
  v_report text := '';
begin
  -- Données de test, visibles uniquement dans cette transaction annulée
  insert into public.delivery_fees (commune, fee_fcfa) values ('Cocody', 1000);
  insert into public.product_inventory (product_id, stock_quantity) values (v_pid, 5)
    on conflict (product_id) do update set stock_quantity = 5;
  v_two := jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 2));
  v_one := jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 1));

  set local role anon;

  -- 1. Honeypot refusé
  begin
    perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000000', 'pickup', null, null, null, v_two, 'http://spam');
    v_report := v_report || E'1 honeypot: ECHEC (accepté)\n';
  exception when others then
    v_report := v_report || format(E'1 honeypot: %s -> %s\n', sqlerrm, case when sqlerrm = 'REQUEST_REJECTED' then 'OK' else 'ECHEC' end);
  end;

  -- 2. Livraison dans une commune sans tarif refusée
  begin
    perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000001', 'delivery', 'Yopougon', '12 rue des tests', null, v_two, '');
    v_report := v_report || E'2 commune sans tarif: ECHEC (acceptée)\n';
  exception when others then
    v_report := v_report || format(E'2 commune sans tarif: %s -> %s\n', sqlerrm, case when sqlerrm = 'NO_DELIVERY_FEE' then 'OK' else 'ECHEC' end);
  end;

  -- 3. Retrait réussi : frais 0, paiement en attente, stock 5 -> 3
  r1 := public.create_order(v_key, 'Test Client', 'test@example.com', '0700000002', 'pickup', null, null, null, v_two, '');
  reset role;
  select stock_quantity into v_stock from public.product_inventory where product_id = v_pid;
  v_report := v_report || format(E'3 retrait: frais=%s paiement=%s stock=%s -> %s\n', r1->>'delivery_fee_fcfa', r1->>'payment_status', v_stock,
    case when (r1->>'delivery_fee_fcfa')::int = 0 and r1->>'payment_status' = 'pending' and v_stock = 3 then 'OK' else 'ECHEC' end);

  -- 4. Rejeu avec la même clé : même commande, pas de double décrément
  set local role anon;
  r2 := public.create_order(v_key, 'Test Client', 'test@example.com', '0700000002', 'pickup', null, null, null, v_two, '');
  reset role;
  select stock_quantity into v_stock from public.product_inventory where product_id = v_pid;
  v_report := v_report || format(E'4 idempotence: meme reference=%s stock=%s -> %s\n', (r1->>'reference') = (r2->>'reference'), v_stock,
    case when (r1->>'reference') = (r2->>'reference') and v_stock = 3 then 'OK' else 'ECHEC' end);

  -- 5. Livraison réussie à Cocody (tarif 1000) : total = sous-total + 1000, stock 3 -> 1
  set local role anon;
  r2 := public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000003', 'delivery', 'Cocody', '12 rue des tests', null, v_two, '');
  reset role;
  v_report := v_report || format(E'5 livraison: frais=%s total=%s -> %s\n', r2->>'delivery_fee_fcfa', r2->>'total_fcfa',
    case when (r2->>'delivery_fee_fcfa')::int = 1000 and (r2->>'total_fcfa')::int = (r2->>'subtotal_fcfa')::int + 1000 then 'OK' else 'ECHEC' end);

  -- 6. Stock insuffisant (reste 1, demande 2) refusé
  begin
    set local role anon;
    perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000004', 'pickup', null, null, null, v_two, '');
    v_report := v_report || E'6 stock insuffisant: ECHEC (accepté)\n';
  exception when others then
    v_report := v_report || format(E'6 stock insuffisant: %s -> %s\n', sqlerrm, case when sqlerrm = 'INSUFFICIENT_STOCK' then 'OK' else 'ECHEC' end);
  end;
  reset role;

  -- 7. Limite par téléphone : 3 commandes passent, la 4e est refusée
  update public.product_inventory set stock_quantity = 50 where product_id = v_pid;
  set local role anon;
  perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000009', 'pickup', null, null, null, v_one, '');
  perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000009', 'pickup', null, null, null, v_one, '');
  perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000009', 'pickup', null, null, null, v_one, '');
  begin
    perform public.create_order(gen_random_uuid(), 'Test Client', 'test@example.com', '0700000009', 'pickup', null, null, null, v_one, '');
    v_report := v_report || E'7 limite telephone: ECHEC (4e acceptée)\n';
  exception when others then
    v_report := v_report || format(E'7 limite telephone: %s -> %s\n', sqlerrm, case when sqlerrm = 'RATE_LIMITED' then 'OK' else 'ECHEC' end);
  end;

  -- 8a. Un visiteur ne peut pas lire les commandes
  begin
    perform 1 from public.orders limit 1;
    v_report := v_report || E'8a anon lit orders: ECHEC (lecture permise)\n';
  exception when others then
    v_report := v_report || E'8a anon lecture orders refusee -> OK\n';
  end;
  reset role;

  -- 8b. Annulation par un administrateur : stock restitué une seule fois (10 + 2 = 12)
  select id into v_order from public.orders where idempotency_key = v_key;
  update public.product_inventory set stock_quantity = 10 where product_id = v_pid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_order_status(v_order, 'confirmed');
  perform public.admin_set_order_status(v_order, 'cancelled');
  reset role;
  select stock_quantity into v_stock from public.product_inventory where product_id = v_pid;
  v_report := v_report || format(E'8b annulation: stock=%s (attendu 12) -> %s\n', v_stock, case when v_stock = 12 then 'OK' else 'ECHEC' end);

  -- 8c/8d. Seconde annulation refusée, stock inchangé
  begin
    set local role authenticated;
    perform public.admin_set_order_status(v_order, 'cancelled');
    v_report := v_report || E'8c double annulation: ECHEC (acceptée)\n';
  exception when others then
    v_report := v_report || format(E'8c double annulation: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_TRANSITION' then 'OK' else 'ECHEC' end);
  end;
  reset role;
  select stock_quantity into v_stock from public.product_inventory where product_id = v_pid;
  v_report := v_report || format(E'8d stock apres 2e tentative: %s -> %s\n', v_stock, case when v_stock = 12 then 'OK' else 'ECHEC' end);

  -- 9. Un non-administrateur ne peut pas changer un statut
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_set_order_status(v_order, 'confirmed');
    v_report := v_report || E'9 non-admin: ECHEC (accepté)\n';
  exception when others then
    v_report := v_report || format(E'9 non-admin: %s -> %s\n', sqlerrm, case when sqlerrm = 'FORBIDDEN' then 'OK' else 'ECHEC' end);
  end;
  reset role;

  raise exception E'RESULTATS DES TESTS (tout est annule)\n%', v_report;
end $$;


-- =====================================================================
-- PARTIE 4 — RETOUR ARRIÈRE
-- À exécuter seulement si la migration doit être défaite.
-- LIMITES : (1) si de VRAIES commandes ont été créées depuis, supprimer les colonnes
-- fulfillment_method / idempotency_key / stock_decremented / stock_restored_at PERD ces
-- informations ; (2) le stock déjà décrémenté par de vraies commandes n'est PAS recalculé
-- automatiquement ; (3) les anciennes politiques sont recréées à l'identique de l'audit.
-- =====================================================================
-- begin;
--   drop function if exists public.admin_set_order_status(uuid, text);
--   drop function if exists public.create_order(uuid, text, text, text, text, text, text, text, jsonb, text);
--   drop function if exists public.get_checkout_config();
--   drop function if exists public.order_summary(uuid);
--
--   alter table public.orders drop constraint if exists orders_status_fulfillment_check;
--   alter table public.orders drop constraint if exists orders_status_check;
--   -- ATTENTION : échoue s'il existe des commandes 'ready_for_pickup' (les traiter avant).
--   alter table public.orders add constraint orders_status_check
--     check (status in ('pending','confirmed','preparing','shipped','delivered','cancelled'));
--
--   alter table public.orders drop constraint if exists orders_delivery_fields_check;
--   -- ATTENTION : échoue s'il existe des commandes en retrait (adresse NULL) : les supprimer/corriger avant.
--   alter table public.orders alter column delivery_address set not null, alter column delivery_commune set not null;
--
--   drop index if exists public.orders_idempotency_key_key;
--   drop index if exists public.orders_phone_created_idx;
--   alter table public.orders
--     drop column if exists stock_restored_at,
--     drop column if exists customer_phone_digits,
--     drop column if exists idempotency_key,
--     drop column if exists fulfillment_method;
--   alter table public.order_items drop column if exists stock_decremented;
--
--   drop table if exists public.delivery_fees;
--   drop table if exists public.order_settings;
--
--   create policy "Customers read own orders" on public.orders
--     for select to authenticated using (customer_id = (select auth.uid()));
--   create policy "Customers read own order items" on public.order_items
--     for select to authenticated using (exists (
--       select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = (select auth.uid())));
-- commit;
