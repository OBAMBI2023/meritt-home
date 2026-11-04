-- =====================================================================
-- MERITT HOME — Stock hybride (en stock / sur commande / indisponible) : migration additive
-- STATUT : PRÉPARÉE, NON APPLIQUÉE. À examiner puis exécuter manuellement : d'abord sur le projet de TEST.
-- Non idempotente (« alter table add column » échouerait au second passage) : ne pas la rejouer.
--
-- Prérequis : migration-commandes.sql (create_order, order_summary, order_settings) déjà appliquée.
--
-- Principes :
--   * products reçoit 3 colonnes (inventory_mode, availability_status, lead_time). La quantité physique reste dans
--     product_inventory (aucune colonne stock_quantity en double). Aucune donnée existante n'est modifiée :
--     tous les produits actuels reçoivent par défaut inventory_mode = 'tracked' et availability_status = 'available'
--     (= comportement actuel). AUCUN produit n'est basculé automatiquement en « sur commande ».
--   * order_items conserve, pour chaque NOUVELLE ligne, le mode de disponibilité au moment de l'achat
--     (anciennes lignes : NULL = antérieur à cette migration ; aucune commande existante n'est modifiée).
--   * create_order reste la source d'autorité (même signature, mêmes droits). Règles :
--       - produit introuvable            -> PRODUCT_NOT_FOUND
--       - non publié / catégorie inactive -> PRODUCT_NOT_PUBLISHED
--       - availability_status = unavailable -> PRODUCT_UNAVAILABLE
--       - tracked  : quantité contrôlée et décrémentée atomiquement (INSUFFICIENT_STOCK) ; sans quantité renseignée :
--                    STOCK_UNTRACKED (sauf si l'ancien réglage order_settings.untracked_stock_policy = 'allow', conservé
--                    par compatibilité)
--       - on_demand : aucune vérification ni décrémentation de stock
--     Le détail de l'erreur (error.details) contient l'identifiant du produit : l'interface en tire le nom.
--   * Les variantes n'existent pas dans le schéma : le contrôle « variante invalide » se limite à la validation des
--     lignes (INVALID_ITEMS : identifiant UUID et quantité 1 à 10). Aucune variante n'est créée.
--   * Aucune table de mouvements de stock n'existe : aucun mouvement n'est créé ni simulé. La restitution du stock à
--     l'annulation (admin_set_order_status) repose sur order_items.stock_decremented : inchangée, et nulle pour les
--     lignes « sur commande ».
--   * RLS : aucune politique nouvelle. Les colonnes de products suivent les politiques existantes (lecture publique des
--     produits publiés, écriture admin). Le signal public « en stock / épuisé » passe par la fonction
--     get_catalogue_availability(), qui ne renvoie JAMAIS de quantité.
--
-- Contenu : PARTIE 0 préflight (lecture seule) · 1 migration (une transaction) · 2 contrôles après application
--           (lecture seule) · 3 liste de migration des produits existants (lecture seule) · 4 retour arrière
-- Exécutez chaque partie séparément dans l'éditeur SQL.
-- =====================================================================


-- =====================================================================
-- PARTIE 0 — PRÉFLIGHT (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'products existe'                            as controle, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'products') as ok
union all select 'order_items existe',               exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'order_items')
union all select 'product_inventory existe',         exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'product_inventory')
union all select 'order_settings (politique) existe', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_settings' and column_name = 'untracked_stock_policy')
union all select 'create_order (10 arguments) existe', exists (select 1 from pg_proc where proname = 'create_order' and pronamespace = 'public'::regnamespace and pronargs = 10)
union all select 'order_summary existe',             exists (select 1 from pg_proc where proname = 'order_summary' and pronamespace = 'public'::regnamespace)
union all select 'colonnes products absentes',       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name in ('inventory_mode', 'availability_status', 'lead_time'))
union all select 'colonnes order_items absentes',    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name in ('inventory_mode', 'lead_time'))
union all select 'get_catalogue_availability absente', not exists (select 1 from pg_proc where proname = 'get_catalogue_availability' and pronamespace = 'public'::regnamespace);

-- Information (aucun contrôle) : état actuel du stock des produits, avant migration.
-- select p.name, p.is_published, i.stock_quantity, (i.product_id is null) as sans_ligne_de_stock
-- from public.products p left join public.product_inventory i on i.product_id = p.id order by p.name;


-- =====================================================================
-- PARTIE 1 — MIGRATION
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1.1 products : mode de gestion, disponibilité, délai indicatif
--     Les valeurs par défaut reproduisent le comportement actuel (produit suivi, disponible).
-- ---------------------------------------------------------------------
alter table public.products
  add column inventory_mode text not null default 'tracked'
    constraint products_inventory_mode_check check (inventory_mode in ('tracked', 'on_demand')),
  add column availability_status text not null default 'available'
    constraint products_availability_status_check check (availability_status in ('available', 'unavailable')),
  add column lead_time text
    constraint products_lead_time_check check (lead_time is null or char_length(btrim(lead_time)) between 1 and 80);

-- ---------------------------------------------------------------------
-- 1.2 order_items : mode de disponibilité au moment de l'achat (NULL pour toutes les lignes existantes)
-- ---------------------------------------------------------------------
alter table public.order_items
  add column inventory_mode text
    constraint order_items_inventory_mode_check check (inventory_mode is null or inventory_mode in ('tracked', 'on_demand')),
  add column lead_time text;

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

commit;


-- =====================================================================
-- PARTIE 2 — CONTRÔLES APRÈS APPLICATION (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'products : 3 colonnes ajoutées'               as controle, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name in ('inventory_mode', 'availability_status', 'lead_time')) = 3 as ok
union all select 'order_items : 2 colonnes ajoutées',   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name in ('inventory_mode', 'lead_time')) = 2
union all select 'aucun produit basculé en sur commande', not exists (select 1 from public.products where inventory_mode <> 'tracked')
union all select 'aucun produit marqué indisponible',   not exists (select 1 from public.products where availability_status <> 'available')
union all select 'lignes de commande existantes inchangées (mode NULL)', not exists (select 1 from public.order_items where inventory_mode is not null or lead_time is not null)
union all select 'create_order : nouvelles règles présentes', (select prosrc like '%PRODUCT_NOT_FOUND%' and prosrc like '%PRODUCT_NOT_PUBLISHED%' and prosrc like '%on_demand%' from pg_proc where proname = 'create_order' and pronamespace = 'public'::regnamespace and pronargs = 10)
union all select 'create_order exécutable par anon',    has_function_privilege('anon', 'public.create_order(uuid,text,text,text,text,text,text,text,jsonb,text)', 'execute')
union all select 'get_catalogue_availability exécutable par anon', has_function_privilege('anon', 'public.get_catalogue_availability()', 'execute')
union all select 'order_summary non exécutable par anon', not has_function_privilege('anon', 'public.order_summary(uuid)', 'execute')
union all select 'product_inventory toujours illisible par anon', not has_table_privilege('anon', 'public.product_inventory', 'select');


-- =====================================================================
-- PARTIE 3 — LISTE DE MIGRATION DES PRODUITS EXISTANTS (lecture seule, à lancer après la PARTIE 1)
-- Aide à décider, produit par produit, du mode à choisir dans l'administration. Rien n'est modifié.
-- =====================================================================
select p.name,
       p.is_published                                                    as publie,
       p.inventory_mode                                                  as mode_actuel,
       p.availability_status                                             as disponibilite_actuelle,
       i.stock_quantity                                                  as stock_actuel,
       case when i.product_id is null then 'aucune ligne de stock'
            when i.stock_quantity is null then 'quantité inconnue'
            when i.stock_quantity = 0 then 'épuisé'
            else 'en stock' end                                          as etat_du_stock,
       case when i.stock_quantity is not null then 'garder « suivi » (stock renseigné)'
            else 'à décider : saisir une quantité OU choisir « sur commande »' end as proposition
from public.products p
left join public.product_inventory i on i.product_id = p.id
order by p.name;


-- =====================================================================
-- PARTIE 4 — RETOUR ARRIÈRE (à n'exécuter qu'avec validation)
-- Étape A (sans perte de données) : réappliquer les sections 1.5 (order_summary) et 1.7 (create_order) de
--   migration-commandes.sql : « create or replace » restaure les fonctions d'origine.
-- Étape B (supprime les colonnes ajoutées : le mode choisi par produit et celui des nouvelles lignes de commande sont perdus) :
-- begin;
-- drop function if exists public.get_catalogue_availability();
-- alter table public.order_items drop column if exists inventory_mode, drop column if exists lead_time;
-- alter table public.products drop column if exists inventory_mode, drop column if exists availability_status, drop column if exists lead_time;
-- commit;
-- Remarque : tant que l'étape A n'est pas faite, ne pas exécuter l'étape B (l'ancien create_order ignore les colonnes,
--   mais le nouveau les lit).
