-- =====================================================================
-- MERITT HOME — PROJET DE TEST UNIQUEMENT (kmjoyioeanjrvohmfash) — migration catalogue, IDEMPOTENTE
-- NE JAMAIS EXECUTER SUR LA PRODUCTION (jvmvsaiduralhezrjeyg) : avant de lancer, verifiez que l'URL de l'editeur SQL
-- contient « kmjoyioeanjrvohmfash ».
--
-- Corrige les trois ecarts de schema releves par playwright-catalogue-test.mjs :
--   1. products.inventory_mode / availability_status / lead_time absents (42703)  -> stock hybride
--   2. RPC get_catalogue_availability() introuvable (PGRST202)                     -> stock hybride
--   3. table site_banners introuvable (PGRST205)                                   -> bannieres
--
-- Prerequis : 04-preflight-catalogue-test.sql doit renvoyer ok = true pour les lignes « prerequis ».
-- Contenu : BLOC A = migration-stock-hybride.sql PARTIE 1 (texte identique, sauf « add column » -> « add column if not exists »)
--           BLOC B = migration-bannieres.sql rendue idempotente (create ... if not exists, drop ... if exists)
-- Chaque bloc est une transaction ; relancer le fichier est sans effet (aucune donnee existante n'est modifiee).
-- Executez le BLOC A, puis le BLOC B, separement dans l'editeur SQL.
-- =====================================================================

-- ===================== BLOC A — STOCK HYBRIDE =====================
begin;

-- ---------------------------------------------------------------------
-- 1.1 products : mode de gestion, disponibilité, délai indicatif
--     Les valeurs par défaut reproduisent le comportement actuel (produit suivi, disponible).
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists inventory_mode text not null default 'tracked'
    constraint products_inventory_mode_check check (inventory_mode in ('tracked', 'on_demand')),
  add column if not exists availability_status text not null default 'available'
    constraint products_availability_status_check check (availability_status in ('available', 'unavailable')),
  add column if not exists lead_time text
    constraint products_lead_time_check check (lead_time is null or char_length(btrim(lead_time)) between 1 and 80);

-- ---------------------------------------------------------------------
-- 1.2 order_items : mode de disponibilité au moment de l'achat (NULL pour toutes les lignes existantes)
-- ---------------------------------------------------------------------
alter table public.order_items
  add column if not exists inventory_mode text
    constraint order_items_inventory_mode_check check (inventory_mode is null or inventory_mode in ('tracked', 'on_demand')),
  add column if not exists lead_time text;

-- ---------------------------------------------------------------------
-- 1.3 Signal public « en stock / épuisé » (jamais de quantité)
--     in_stock : NULL pour un produit « sur commande » ; sinon vrai si quantité > 0 (ou, par compatibilité avec l'ancien
--     réglage, quantité non renseignée et order_settings.untracked_stock_policy = 'allow').
-- ---------------------------------------------------------------------
create or replace function public.get_catalogue_availability()
returns table (product_id uuid, in_stock boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         case when p.inventory_mode = 'tracked' then
           (coalesce(i.stock_quantity, 0) > 0
            or (i.stock_quantity is null
                and coalesce((select s.untracked_stock_policy from public.order_settings s limit 1), 'reject') = 'allow'))
         end
  from public.products p
  left join public.product_inventory i on i.product_id = p.id
  where p.is_published
    and exists (select 1 from public.categories c where c.id = p.category_id and c.is_active);
$$;
revoke all on function public.get_catalogue_availability() from public;
grant execute on function public.get_catalogue_availability() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.4 order_summary : ajoute le mode et le délai de chaque ligne (usage interne, non exposé aux rôles API)
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
               'line_total_fcfa', oi.line_total_fcfa,
               'inventory_mode', oi.inventory_mode,
               'lead_time', oi.lead_time)
             order by oi.created_at, oi.id)
      from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;
revoke all on function public.order_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.5 create_order : mêmes arguments, mêmes droits, mêmes validations ; seules les règles de disponibilité et de stock changent.
--     Codes d'erreur (error.message) : REQUEST_REJECTED, INVALID_REQUEST, INVALID_CUSTOMER, INVALID_PHONE, INVALID_ITEMS,
--       INVALID_FULFILLMENT, INVALID_ADDRESS, RATE_LIMITED, PRODUCT_NOT_FOUND, PRODUCT_NOT_PUBLISHED, PRODUCT_UNAVAILABLE,
--       STOCK_UNTRACKED, INSUFFICIENT_STOCK, NO_DELIVERY_FEE, AMOUNT_TOO_LARGE
--     Pour les erreurs de produit, error.details = identifiant du produit concerné.
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

  -- Verrous (ordre déterministe par id) : produits en partage (leur mode ne peut pas changer pendant la commande),
  -- inventaire en écriture (deux commandes simultanées pour le dernier article sont sérialisées : aucune survente).
  perform 1 from public.products p
    where p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(p_items) e)
    order by p.id for share;
  perform 1 from public.product_inventory i
    where i.product_id in (select (e->>'product_id')::uuid from jsonb_array_elements(p_items) e)
    order by i.product_id for update;

  -- Lignes : existence, publication, disponibilité, puis règle de stock selon le mode ; prix lu en base.
  for v_row in
    with wanted as (
      select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::int)::int4 as qty
      from jsonb_array_elements(p_items) e
      group by 1
    )
    select w.product_id, w.qty, p.id as pid, p.name, p.price_fcfa, p.is_published, p.inventory_mode,
           p.availability_status, p.lead_time, coalesce(c.is_active, false) as category_active,
           (i.product_id is not null) as has_row, i.stock_quantity
    from wanted w
    left join public.products p on p.id = w.product_id
    left join public.categories c on c.id = p.category_id
    left join public.product_inventory i on i.product_id = w.product_id
    order by w.product_id
  loop
    if v_row.pid is null then
      raise exception 'PRODUCT_NOT_FOUND' using detail = v_row.product_id::text;
    end if;
    if not v_row.is_published or not v_row.category_active then
      raise exception 'PRODUCT_NOT_PUBLISHED' using detail = v_row.product_id::text;
    end if;
    if v_row.availability_status = 'unavailable' then
      raise exception 'PRODUCT_UNAVAILABLE' using detail = v_row.product_id::text;
    end if;

    v_dec := 0;
    if v_row.inventory_mode = 'tracked' then
      if v_row.has_row and v_row.stock_quantity is not null then
        update public.product_inventory
           set stock_quantity = stock_quantity - v_row.qty
         where product_id = v_row.product_id and stock_quantity >= v_row.qty;
        if not found then
          raise exception 'INSUFFICIENT_STOCK' using detail = v_row.product_id::text;
        end if;
        v_dec := v_row.qty;
      elsif v_settings.untracked_stock_policy <> 'allow' then
        raise exception 'STOCK_UNTRACKED' using detail = v_row.product_id::text;
      end if;
    end if;
    -- inventory_mode = 'on_demand' : aucune vérification ni décrémentation (v_dec reste 0).

    v_subtotal := v_subtotal + v_row.price_fcfa::int8 * v_row.qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_row.product_id, 'name', v_row.name,
      'unit', v_row.price_fcfa, 'qty', v_row.qty, 'dec', v_dec,
      'mode', v_row.inventory_mode, 'lead', v_row.lead_time));
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

  insert into public.order_items (order_id, product_id, product_name, unit_price_fcfa, quantity, line_total_fcfa, stock_decremented, inventory_mode, lead_time)
  select v_order_id, (l->>'product_id')::uuid, l->>'name', (l->>'unit')::int4, (l->>'qty')::int4,
         (l->>'unit')::int4 * (l->>'qty')::int4, (l->>'dec')::int4, l->>'mode', l->>'lead'
  from jsonb_array_elements(v_lines) l;

  return public.order_summary(v_order_id);
end;
$$;
revoke all on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;


-- ===================== BLOC B — BANNIERES (site_banners) =====================
begin;

create table if not exists public.site_banners (
  id         boolean primary key default true check (id),   -- une seule ligne possible
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_banners (id) values (true) on conflict (id) do nothing;

drop trigger if exists site_banners_set_updated_at on public.site_banners;
create trigger site_banners_set_updated_at
  before update on public.site_banners
  for each row execute function public.set_updated_at();

alter table public.site_banners enable row level security;

drop policy if exists "Anyone reads site banners" on public.site_banners;
create policy "Anyone reads site banners" on public.site_banners
  for select to anon, authenticated using (true);
drop policy if exists "Admins write site banners" on public.site_banners;
create policy "Admins write site banners" on public.site_banners
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.site_banners from anon, authenticated;
grant select on public.site_banners to anon;
grant select, insert, update on public.site_banners to authenticated;

notify pgrst, 'reload schema';

commit;
