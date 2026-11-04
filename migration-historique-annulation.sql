-- =====================================================================
-- MERITT HOME — Historique des statuts de commande et restitution du stock traçable : migration additive
-- STATUT : PRÉPARÉE, NON APPLIQUÉE. À examiner puis exécuter manuellement : d'abord sur le projet de TEST (kmjoyioeanjrvohmfash).
-- NE JAMAIS l'exécuter sur la production sans validation explicite. Vérifiez que l'URL de l'éditeur SQL contient la référence du projet visé.
--
-- Prérequis : migration-commandes.sql appliquée (orders, order_items.stock_decremented, orders.stock_restored_at,
--             admin_set_order_status, order_summary, is_admin).
--
-- Corrections couvertes (audit « annulation de commande et restitution du stock ») :
--   1. Historique des changements de statut : table order_status_events, immuable, lisible par les administrateurs seulement.
--      Chaque appel réussi de admin_set_order_status y ajoute une ligne (ancien et nouveau statut, auteur, unités de stock).
--   3. Restitution traçable : à l'annulation, la fonction compte les unités à restituer et les unités réellement restituées.
--      Quand une ligne de stock est absente ou NULL, la restitution de ce produit est IMPOSSIBLE : on ne crée AUCUNE quantité
--      (pas de stock inventé) ; l'annulation reste possible, l'écart est enregistré dans l'historique et renvoyé à l'interface.
--   (La correction 2 — confirmation avant annulation et message exact — est côté interface : lib/admin/orders.ts et orders-section.tsx.)
--
-- Ce qui ne change PAS : signature et droits de admin_set_order_status, matrice des transitions, statut terminal « cancelled »,
-- garde stock_restored_at, verrou de la commande (for update), payment_status jamais modifié. Aucune donnée existante n'est modifiée.
-- La valeur de retour reste order_summary(...) ; deux clés sont AJOUTÉES (stock_units_to_restore, stock_units_restored) :
-- l'ancienne interface les ignore.
--
-- Contenu : PARTIE 0 préflight (lecture seule) · 1 migration (une transaction, idempotente) · 2 contrôles (lecture seule) · 3 retour arrière
-- Exécutez chaque partie séparément dans l'éditeur SQL.
-- =====================================================================


-- =====================================================================
-- PARTIE 0 — PRÉFLIGHT (lecture seule). Attendu : toutes les lignes « prerequis » à true.
-- =====================================================================
select 'prerequis : orders'                      as controle, to_regclass('public.orders') is not null as ok
union all select 'prerequis : order_items',       to_regclass('public.order_items') is not null
union all select 'prerequis : orders.stock_restored_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='stock_restored_at')
union all select 'prerequis : order_items.stock_decremented', exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='stock_decremented')
union all select 'prerequis : admin_set_order_status(uuid,text)', exists (select 1 from pg_proc where proname='admin_set_order_status' and pronamespace='public'::regnamespace and pronargs=2)
union all select 'prerequis : order_summary', exists (select 1 from pg_proc where proname='order_summary' and pronamespace='public'::regnamespace)
union all select 'prerequis : is_admin()', exists (select 1 from pg_proc where proname='is_admin' and pronamespace='public'::regnamespace)
union all select 'etat : order_status_events (attendu false avant)', to_regclass('public.order_status_events') is not null;


-- =====================================================================
-- PARTIE 1 — MIGRATION
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1.1 Historique des statuts : une ligne par changement réussi ; jamais modifiable ni supprimable.
-- ---------------------------------------------------------------------
create table if not exists public.order_status_events (
  id                    bigint generated always as identity primary key,
  order_id              uuid        not null references public.orders (id),
  from_status           text        not null,
  to_status             text        not null,
  actor_id              uuid,                       -- auth.uid() de l'administrateur
  actor_email           text,                       -- e-mail du jeton (information, pas une preuve d'identité)
  stock_units_to_restore int4       not null default 0 check (stock_units_to_restore >= 0),
  stock_units_restored   int4       not null default 0 check (stock_units_restored >= 0),
  created_at            timestamptz not null default now(),
  constraint order_status_events_restore_check check (stock_units_restored <= stock_units_to_restore)
);
create index if not exists order_status_events_order_idx on public.order_status_events (order_id, created_at);

-- Garde-fou : même un accès direct ne peut ni modifier ni supprimer l'historique.
create or replace function public.order_status_events_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'ORDER_STATUS_HISTORY_IMMUTABLE';
end;
$$;
revoke all on function public.order_status_events_guard() from public, anon, authenticated;
drop trigger if exists order_status_events_guard on public.order_status_events;
create trigger order_status_events_guard before update or delete on public.order_status_events
  for each row execute function public.order_status_events_guard();

alter table public.order_status_events enable row level security;
drop policy if exists "Admins read order status events" on public.order_status_events;
create policy "Admins read order status events" on public.order_status_events
  for select to authenticated using ((select public.is_admin()));

-- Droits explicites : lecture seule pour les administrateurs ; l'écriture passe uniquement par admin_set_order_status.
revoke all on public.order_status_events from anon, authenticated;
grant select on public.order_status_events to authenticated;

-- ---------------------------------------------------------------------
-- 1.2 admin_set_order_status : corps identique à migration-commandes.sql (§1.8) ; ajouts signalés par « NOUVEAU ».
-- ---------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders%rowtype;
  v_allowed    text[];
  v_to_restore int4 := 0;   -- NOUVEAU : unités décrémentées à la commande (toutes lignes)
  v_restored   int4 := 0;   -- NOUVEAU : unités effectivement remises en stock
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
      -- NOUVEAU : total à restituer (inclut une éventuelle ligne dont le produit a été supprimé : elle ne pourra pas l'être).
      select coalesce(sum(oi.stock_decremented), 0)::int4 into v_to_restore
        from public.order_items oi
       where oi.order_id = v_order.id and oi.stock_decremented > 0;

      -- Même mise à jour qu'avant (stock existant uniquement : jamais de quantité créée) ; NOUVEAU : on compte ce qui est restitué.
      with r as (
        select oi.product_id, sum(oi.stock_decremented)::int4 as qty
          from public.order_items oi
         where oi.order_id = v_order.id and oi.product_id is not null and oi.stock_decremented > 0
         group by oi.product_id
      ), u as (
        update public.product_inventory i
           set stock_quantity = i.stock_quantity + r.qty
          from r
         where i.product_id = r.product_id and i.stock_quantity is not null
        returning r.qty
      )
      select coalesce(sum(u.qty), 0)::int4 into v_restored from u;
    end if;
    update public.orders set status = 'cancelled', stock_restored_at = coalesce(stock_restored_at, now()) where id = v_order.id;
  else
    update public.orders set status = p_new_status where id = v_order.id;
  end if;

  -- NOUVEAU : historique (même transaction : si une étape échoue, rien n'est enregistré ni restitué).
  insert into public.order_status_events (order_id, from_status, to_status, actor_id, actor_email, stock_units_to_restore, stock_units_restored)
  values (v_order.id, v_order.status, p_new_status, (select auth.uid()), (select auth.jwt() ->> 'email'), v_to_restore, v_restored);

  return public.order_summary(v_order.id)
         || jsonb_build_object('stock_units_to_restore', v_to_restore, 'stock_units_restored', v_restored);  -- NOUVEAU
end;
$$;
revoke all on function public.admin_set_order_status(uuid, text) from public, anon;
grant execute on function public.admin_set_order_status(uuid, text) to authenticated;

-- Demande à l'API (PostgREST) de recharger son cache de schéma.
notify pgrst, 'reload schema';

commit;


-- =====================================================================
-- PARTIE 2 — CONTRÔLES APRÈS APPLICATION (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'order_status_events existe'              as controle, to_regclass('public.order_status_events') is not null as ok
union all select 'RLS activée',                   coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.order_status_events')), false)
union all select '1 politique (lecture admin)',   (select count(*) from pg_policies where schemaname='public' and tablename='order_status_events') = 1
union all select 'garde anti-modification (trigger)', exists (select 1 from pg_trigger where tgrelid = to_regclass('public.order_status_events') and tgname = 'order_status_events_guard')
union all select 'authenticated : lecture seule', has_table_privilege('authenticated','public.order_status_events','select') and not has_table_privilege('authenticated','public.order_status_events','insert') and not has_table_privilege('authenticated','public.order_status_events','update') and not has_table_privilege('authenticated','public.order_status_events','delete')
union all select 'anon : aucun accès',            not has_table_privilege('anon','public.order_status_events','select')
union all select 'admin_set_order_status : anon NON',           not has_function_privilege('anon','public.admin_set_order_status(uuid,text)','execute')
union all select 'admin_set_order_status : authenticated oui',  has_function_privilege('authenticated','public.admin_set_order_status(uuid,text)','execute')
union all select 'admin_set_order_status : écrit l''historique', exists (select 1 from pg_proc where proname='admin_set_order_status' and pronamespace='public'::regnamespace and prosrc like '%order_status_events%')
union all select 'admin_set_order_status : search_path fixé',   exists (select 1 from pg_proc where proname='admin_set_order_status' and pronamespace='public'::regnamespace and prosecdef and proconfig::text like '%search_path%');


-- =====================================================================
-- PARTIE 3 — RETOUR ARRIÈRE (à n'exécuter qu'avec validation). Les lignes d'historique déjà écrites seraient perdues :
-- exportez-les d'abord (select * from public.order_status_events).
-- =====================================================================
-- begin;
-- -- Restaure la fonction d'origine : coller ici le corps de migration-commandes.sql §1.8 (create or replace function public.admin_set_order_status …).
-- drop trigger if exists order_status_events_guard on public.order_status_events;
-- drop table if exists public.order_status_events;
-- drop function if exists public.order_status_events_guard();
-- notify pgrst, 'reload schema';
-- commit;
