-- =====================================================================
-- MERITT HOME — Module de facturation : migration additive (PROPOSITION)
-- Projet Supabase de production : jvmvsaiduralhezrjeyg
--
-- STATUT : NON APPLIQUÉE en production (constaté le 31/10/2026 dans le tableau de bord : aucune table de facturation,
-- aucune fonction, aucun trigger ni aucune politique de ce module ; prérequis commandes et encaissements en place).
-- À relire puis à appliquer manuellement : PARTIE 0 (contrôles), PARTIE 1, puis PARTIE 2. Tant qu'elle n'est pas
-- appliquée, l'administration signale que le module de facturation n'est pas installé.
-- Prérequis (dans cet ordre) : migration-commandes.sql (PARTIE 1) puis migration-encaissements.sql (PARTIE 1).
-- Validée sur PostgreSQL en mémoire (PGlite) avec ces deux migrations.
--
-- Principes :
--   * une facture naît d'une commande existante : lignes, frais, total et client sont lus EN BASE par une fonction ;
--     le navigateur n'envoie jamais de montant ;
--   * instantané : le client, les lignes et les montants sont copiés dans la facture ; l'entreprise émettrice est copiée à
--     l'ÉMISSION. Un changement ultérieur du catalogue, du client ou des réglages n'altère pas une facture émise ;
--   * numérotation MH-FACT-AAAA-NNNNNN attribuée à l'émission par un compteur annuel verrouillé : sans doublon, sans trou
--     (le compteur est annulé avec la transaction) et jamais réutilisée (aucune facture n'est supprimée) ;
--   * une facture émise est immuable (déclencheur) ; seule l'annulation motivée est possible ; correction = annulation puis
--     nouvelle facture qui référence l'ancienne (replaces_invoice_id). AUCUN AVOIR n'est géré : à décider avec la fiscalité ;
--   * l'état de règlement (non payée / partielle / payée / en retard) est CALCULÉ à partir des paiements CONFIRMÉS
--     (vue v_invoices) : jamais stocké, donc jamais périmé ;
--   * aucun taux de taxe, numéro fiscal, RCCM ni adresse n'est inventé : tout est saisi dans company_settings (vide au départ) ;
--   * aucune écriture directe : tables en lecture seule pour les administrateurs, écritures par fonctions réservées aux
--     administrateurs (is_admin()) ; aucun droit pour le rôle anonyme.
--
-- Contenu : PARTIE 0 contrôles · 1 migration · 2 vérifications · 3 tests (annulés automatiquement) · 4 retour arrière
-- =====================================================================


-- =====================================================================
-- PARTIE 0 — CONTRÔLES PRÉALABLES (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'migration commandes appliquée' as controle,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='fulfillment_method') as ok
union all select 'migration encaissements appliquée (order_payments)', to_regclass('public.order_payments') is not null
union all select 'is_admin() existe',        exists (select 1 from pg_proc where proname='is_admin' and pronamespace='public'::regnamespace)
union all select 'set_updated_at() existe',  exists (select 1 from pg_proc where proname='set_updated_at' and pronamespace='public'::regnamespace)
union all select 'tables de facturation absentes', not exists (select 1 from information_schema.tables where table_schema='public' and table_name in ('company_settings','invoices','invoice_lines','invoice_events','invoice_counters'));


-- =====================================================================
-- PARTIE 1 — MIGRATION
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1.1 Coordonnées et mentions de l'entreprise (une seule ligne, VIDE au départ : rien n'est inventé).
--     company_name est obligatoire pour ÉMETTRE une facture ; tout le reste est facultatif.
-- ---------------------------------------------------------------------
create table public.company_settings (
  id             boolean primary key default true check (id),
  company_name   text check (company_name is null or char_length(btrim(company_name)) between 2 and 120),
  address        text check (address is null or char_length(address) <= 300),
  phone          text check (phone is null or char_length(phone) <= 40),
  email          text check (email is null or char_length(email) <= 120),
  tax_id         text check (tax_id is null or char_length(tax_id) <= 60),
  rccm           text check (rccm is null or char_length(rccm) <= 60),
  legal_notice   text check (legal_notice is null or char_length(legal_notice) <= 600),
  payment_terms  text check (payment_terms is null or char_length(payment_terms) <= 400),
  due_days       int4 check (due_days is null or due_days between 0 and 365),
  updated_at     timestamptz not null default now()
);
insert into public.company_settings (id) values (true);
create trigger company_settings_set_updated_at before update on public.company_settings
  for each row execute function public.set_updated_at();

-- Compteur annuel : une ligne par année, verrouillée pendant l'émission (sans doublon, sans trou).
create table public.invoice_counters (
  year        int4 primary key,
  last_number int4 not null check (last_number >= 0)
);

-- ---------------------------------------------------------------------
-- 1.2 Factures, lignes et historique
-- ---------------------------------------------------------------------
create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  number              text unique,
  order_id            uuid not null references public.orders(id) on delete restrict,
  status              text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  issued_at           timestamptz,
  due_at              date,
  -- Instantané client (corrigeable en brouillon uniquement)
  customer_name       text not null check (char_length(btrim(customer_name)) between 2 and 120),
  customer_email      text check (customer_email is null or char_length(customer_email) <= 254),
  customer_phone      text check (customer_phone is null or char_length(customer_phone) <= 40),
  billing_address     text check (billing_address is null or char_length(billing_address) <= 400),
  fulfillment_method  text not null check (fulfillment_method in ('delivery', 'pickup')),
  currency            text not null default 'FCFA',
  -- Montants copiés de la commande (jamais saisis)
  subtotal_fcfa       int4 not null check (subtotal_fcfa >= 0),
  delivery_fee_fcfa   int4 not null check (delivery_fee_fcfa >= 0),
  total_fcfa          int4 not null check (total_fcfa >= 0),
  notes               text check (notes is null or char_length(notes) <= 500),
  -- Instantané de l'entreprise, figé à l'émission
  company_snapshot    jsonb,
  replaces_invoice_id uuid references public.invoices(id) on delete restrict,
  created_by          uuid references auth.users(id) on delete set null,
  created_by_email    text,
  issued_by_email     text,
  cancelled_at        timestamptz,
  cancelled_by_email  text,
  cancel_reason       text check (cancel_reason is null or char_length(cancel_reason) between 5 and 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint invoices_total_check check (total_fcfa = subtotal_fcfa + delivery_fee_fcfa),
  constraint invoices_number_check check ((status = 'draft') = (number is null) or status = 'cancelled'),
  constraint invoices_issued_check check (status = 'draft' or issued_at is not null or status = 'cancelled'),
  constraint invoices_cancel_check check ((status = 'cancelled') = (cancelled_at is not null))
);
create index invoices_order_idx on public.invoices (order_id);
create index invoices_issued_idx on public.invoices (issued_at desc);
create index invoices_status_idx on public.invoices (status);
-- Une seule facture ACTIVE (brouillon ou émise) par commande : protège contre les doubles créations et émissions.
create unique index invoices_one_active_per_order on public.invoices (order_id) where status in ('draft', 'issued');
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete restrict,
  position        int4 not null check (position >= 1),
  product_id      uuid,
  description     text not null check (char_length(btrim(description)) >= 1),
  quantity        int4 not null check (quantity >= 1),
  unit_price_fcfa int4 not null check (unit_price_fcfa >= 0),
  line_total_fcfa int4 not null,
  constraint invoice_lines_check check (line_total_fcfa = unit_price_fcfa * quantity),
  constraint invoice_lines_position_key unique (invoice_id, position)
);

create table public.invoice_events (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete restrict,
  event       text not null check (event in ('created', 'draft_updated', 'issued', 'cancelled')),
  from_status text,
  to_status   text,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  reason      text check (reason is null or char_length(reason) <= 500),
  created_at  timestamptz not null default now()
);
create index invoice_events_invoice_idx on public.invoice_events (invoice_id, created_at);

-- ---------------------------------------------------------------------
-- 1.3 Garde-fous : immuabilité d'une facture émise, aucune suppression, lignes et historique figés.
-- ---------------------------------------------------------------------
create function public.invoices_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name in ('invoice_lines', 'invoice_events') then
    raise exception 'INVOICE_RECORD_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'INVOICE_DELETE_FORBIDDEN';
  end if;
  -- Champs jamais modifiables, quel que soit l'état.
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.created_at is distinct from old.created_at
     or new.replaces_invoice_id is distinct from old.replaces_invoice_id or new.subtotal_fcfa is distinct from old.subtotal_fcfa
     or new.delivery_fee_fcfa is distinct from old.delivery_fee_fcfa or new.total_fcfa is distinct from old.total_fcfa
     or new.fulfillment_method is distinct from old.fulfillment_method or new.currency is distinct from old.currency then
    raise exception 'INVOICE_IMMUTABLE';
  end if;
  if old.status in ('issued', 'cancelled') then
    -- Après l'émission : seule l'annulation motivée est possible ; tout le reste est figé.
    if not (old.status = 'issued' and new.status = 'cancelled') and new.status is distinct from old.status then
      raise exception 'INVOICE_IMMUTABLE';
    end if;
    if new.number is distinct from old.number or new.issued_at is distinct from old.issued_at or new.due_at is distinct from old.due_at
       or new.customer_name is distinct from old.customer_name or new.customer_email is distinct from old.customer_email
       or new.customer_phone is distinct from old.customer_phone or new.billing_address is distinct from old.billing_address
       or new.notes is distinct from old.notes or new.company_snapshot is distinct from old.company_snapshot then
      raise exception 'INVOICE_IMMUTABLE';
    end if;
    if old.status = 'cancelled' and (new.cancelled_at is distinct from old.cancelled_at or new.cancel_reason is distinct from old.cancel_reason) then
      raise exception 'INVOICE_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.invoices_guard() from public, anon, authenticated;
create trigger invoices_guard before update or delete on public.invoices for each row execute function public.invoices_guard();
create trigger invoice_lines_guard before update or delete on public.invoice_lines for each row execute function public.invoices_guard();
create trigger invoice_events_guard before update or delete on public.invoice_events for each row execute function public.invoices_guard();

-- ---------------------------------------------------------------------
-- 1.4 RLS : lecture réservée aux administrateurs ; aucune écriture directe ; aucun accès public.
-- ---------------------------------------------------------------------
alter table public.company_settings enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_events enable row level security;

create policy "Admins manage company settings" on public.company_settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins read invoices" on public.invoices for select to authenticated using ((select public.is_admin()));
create policy "Admins read invoice lines" on public.invoice_lines for select to authenticated using ((select public.is_admin()));
create policy "Admins read invoice events" on public.invoice_events for select to authenticated using ((select public.is_admin()));
-- invoice_counters : aucune politique, aucun droit : uniquement les fonctions.

revoke all on public.company_settings, public.invoice_counters, public.invoices, public.invoice_lines, public.invoice_events from anon, authenticated;
grant select, update on public.company_settings to authenticated;
grant select on public.invoices, public.invoice_lines, public.invoice_events to authenticated;

-- ---------------------------------------------------------------------
-- 1.5 Vue de lecture : facture + commande + règlement CALCULÉ à partir des paiements confirmés.
--     display_status : draft | cancelled | paid | overdue | partially_paid | issued
-- ---------------------------------------------------------------------
create view public.v_invoices with (security_invoker = true) as
with base as (
  select i.*, o.reference as order_reference, o.status as order_status,
         coalesce((select sum(p.amount_fcfa) from public.order_payments p where p.order_id = i.order_id and p.status = 'confirmed'), 0)::int4 as paid_fcfa,
         prev.number as replaces_number
  from public.invoices i
  join public.orders o on o.id = i.order_id
  left join public.invoices prev on prev.id = i.replaces_invoice_id
)
select b.id, b.number, b.order_id, b.order_reference, b.order_status, b.status, b.issued_at, b.due_at,
       b.customer_name, b.customer_email, b.customer_phone, b.billing_address, b.fulfillment_method, b.currency,
       b.subtotal_fcfa, b.delivery_fee_fcfa, b.total_fcfa, b.notes, b.company_snapshot,
       b.replaces_invoice_id, b.replaces_number, b.created_by_email, b.issued_by_email,
       b.cancelled_at, b.cancelled_by_email, b.cancel_reason, b.created_at,
       b.paid_fcfa, (b.total_fcfa - b.paid_fcfa)::int4 as balance_fcfa,
       (b.status = 'issued' and b.paid_fcfa < b.total_fcfa and b.due_at is not null and b.due_at < current_date) as is_overdue,
       case
         when b.status = 'draft' then 'draft'
         when b.status = 'cancelled' then 'cancelled'
         when b.paid_fcfa >= b.total_fcfa then 'paid'
         when b.due_at is not null and b.due_at < current_date then 'overdue'
         when b.paid_fcfa > 0 then 'partially_paid'
         else 'issued'
       end as display_status
from base b;
revoke all on public.v_invoices from anon, authenticated;
grant select on public.v_invoices to authenticated;

-- ---------------------------------------------------------------------
-- 1.6 Fonctions (SECURITY DEFINER, search_path fixé, réservées aux administrateurs)
--     Codes d'erreur : FORBIDDEN, INVALID_REQUEST, ORDER_NOT_FOUND, ORDER_CANCELLED, ORDER_HAS_NO_ITEMS, TOTAL_MISMATCH,
--     INVOICE_NOT_FOUND, INVOICE_NOT_DRAFT, INVALID_TRANSITION, COMPANY_SETTINGS_REQUIRED, PAYMENTS_EXIST,
--     REASON_REQUIRED, INVALID_CUSTOMER, INVALID_DATE, INVALID_NOTE, INVALID_PERIOD
-- ---------------------------------------------------------------------
create function public.invoice_summary(p_invoice_id uuid) returns jsonb
language sql security definer set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'order_id', i.order_id, 'order_reference', o.reference,
    'total_fcfa', i.total_fcfa, 'due_at', i.due_at, 'issued_at', i.issued_at)
  from public.invoices i join public.orders o on o.id = i.order_id where i.id = p_invoice_id;
$$;
revoke all on function public.invoice_summary(uuid) from public, anon, authenticated;

-- 1.6.a Brouillon à partir d'une commande : toutes les données viennent de la base.
create function public.create_invoice_draft(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order  public.orders%rowtype;
  v_exist  uuid;
  v_sum    int8;
  v_count  int4;
  v_id     uuid;
  v_prev   uuid;
  v_email  text := (select auth.jwt() ->> 'email');
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  if p_order_id is null then raise exception 'INVALID_REQUEST'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;

  -- Déjà une facture active : on la renvoie (aucun doublon possible).
  select id into v_exist from public.invoices where order_id = p_order_id and status in ('draft', 'issued');
  if found then
    return public.invoice_summary(v_exist) || jsonb_build_object('already_exists', true);
  end if;

  select count(*), coalesce(sum(line_total_fcfa), 0) into v_count, v_sum from public.order_items where order_id = p_order_id;
  if v_count = 0 then raise exception 'ORDER_HAS_NO_ITEMS'; end if;
  if v_sum <> v_order.subtotal_fcfa or v_sum + v_order.delivery_fee_fcfa <> v_order.total_fcfa then raise exception 'TOTAL_MISMATCH'; end if;

  -- Correction d'une facture annulée : la nouvelle facture référence la dernière annulée (trace).
  select id into v_prev from public.invoices where order_id = p_order_id and status = 'cancelled' and number is not null order by cancelled_at desc limit 1;

  insert into public.invoices (order_id, customer_name, customer_email, customer_phone, billing_address, fulfillment_method,
                               subtotal_fcfa, delivery_fee_fcfa, total_fcfa, replaces_invoice_id, created_by, created_by_email)
  values (p_order_id, v_order.customer_name, v_order.customer_email, v_order.customer_phone,
          case when v_order.fulfillment_method = 'delivery' then concat_ws(', ', v_order.delivery_address, v_order.delivery_commune) end,
          v_order.fulfillment_method, v_order.subtotal_fcfa, v_order.delivery_fee_fcfa, v_order.total_fcfa,
          v_prev, (select auth.uid()), v_email)
  returning id into v_id;

  insert into public.invoice_lines (invoice_id, position, product_id, description, quantity, unit_price_fcfa, line_total_fcfa)
  select v_id, (row_number() over (order by oi.created_at, oi.id))::int4, oi.product_id, oi.product_name, oi.quantity, oi.unit_price_fcfa, oi.line_total_fcfa
  from public.order_items oi where oi.order_id = p_order_id;

  insert into public.invoice_events (invoice_id, event, to_status, actor_id, actor_email, reason)
  values (v_id, 'created', 'draft', (select auth.uid()), v_email, case when v_prev is not null then 'Remplace une facture annulée' end);

  return public.invoice_summary(v_id) || jsonb_build_object('already_exists', false);
end;
$$;
revoke all on function public.create_invoice_draft(uuid) from public, anon;
grant execute on function public.create_invoice_draft(uuid) to authenticated;

-- 1.6.b Correction d'un brouillon (identité de facturation, échéance, note). Les montants ne sont jamais modifiables.
create function public.update_invoice_draft(p_invoice_id uuid, p_customer_name text, p_customer_email text, p_customer_phone text, p_billing_address text, p_due_at date, p_notes text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv   public.invoices%rowtype;
  v_name  text := btrim(coalesce(p_customer_name, ''));
  v_email text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_customer_phone, '')), '');
  v_addr  text := nullif(btrim(coalesce(p_billing_address, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_actor text := (select auth.jwt() ->> 'email');
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_inv.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;
  if char_length(v_name) not between 2 and 120 or (v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
     or (v_phone is not null and char_length(v_phone) > 40) or (v_addr is not null and char_length(v_addr) > 400) then
    raise exception 'INVALID_CUSTOMER';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then raise exception 'INVALID_NOTE'; end if;
  if p_due_at is not null and p_due_at < current_date - 1 then raise exception 'INVALID_DATE'; end if;

  update public.invoices set customer_name = v_name, customer_email = v_email, customer_phone = v_phone,
         billing_address = v_addr, due_at = p_due_at, notes = v_notes where id = p_invoice_id;
  insert into public.invoice_events (invoice_id, event, from_status, to_status, actor_id, actor_email)
  values (p_invoice_id, 'draft_updated', 'draft', 'draft', (select auth.uid()), v_actor);
  return public.invoice_summary(p_invoice_id);
end;
$$;
revoke all on function public.update_invoice_draft(uuid, text, text, text, text, date, text) from public, anon;
grant execute on function public.update_invoice_draft(uuid, text, text, text, text, date, text) to authenticated;

-- 1.6.c Émission : numéro attribué ici, instantané de l'entreprise figé, échéance calculée si les réglages le prévoient.
create function public.issue_invoice(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv     public.invoices%rowtype;
  v_order   public.orders%rowtype;
  v_company public.company_settings%rowtype;
  v_year    int4 := extract(year from current_date)::int4;
  v_n       int4;
  v_sum     int8;
  v_actor   text := (select auth.jwt() ->> 'email');
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_inv.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;

  select * into v_order from public.orders where id = v_inv.order_id for update;
  if v_order.status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;
  -- La commande n'a pas changé depuis le brouillon.
  select coalesce(sum(line_total_fcfa), 0) into v_sum from public.order_items where order_id = v_inv.order_id;
  if v_sum <> v_inv.subtotal_fcfa or v_order.total_fcfa <> v_inv.total_fcfa or v_order.delivery_fee_fcfa <> v_inv.delivery_fee_fcfa then raise exception 'TOTAL_MISMATCH'; end if;

  select * into v_company from public.company_settings limit 1;
  if v_company.company_name is null then raise exception 'COMPANY_SETTINGS_REQUIRED'; end if;

  -- Compteur annuel : la ligne est verrouillée jusqu'à la fin de la transaction (pas de doublon, pas de trou).
  insert into public.invoice_counters (year, last_number) values (v_year, 1)
    on conflict (year) do update set last_number = public.invoice_counters.last_number + 1
    returning last_number into v_n;

  update public.invoices
     set status = 'issued',
         number = 'MH-FACT-' || v_year::text || '-' || lpad(v_n::text, 6, '0'),
         issued_at = now(),
         issued_by_email = v_actor,
         due_at = coalesce(v_inv.due_at, case when v_company.due_days is not null then current_date + v_company.due_days end),
         company_snapshot = to_jsonb(v_company) - 'id' - 'updated_at'
   where id = p_invoice_id;
  insert into public.invoice_events (invoice_id, event, from_status, to_status, actor_id, actor_email)
  values (p_invoice_id, 'issued', 'draft', 'issued', (select auth.uid()), v_actor);
  return public.invoice_summary(p_invoice_id);
end;
$$;
revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- 1.6.d Annulation motivée (brouillon ou facture émise). Refusée tant que des paiements confirmés existent.
create function public.cancel_invoice(p_invoice_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv    public.invoices%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_paid   int8;
  v_actor  text := (select auth.jwt() ->> 'email');
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_inv.status not in ('draft', 'issued') then raise exception 'INVALID_TRANSITION' using detail = v_inv.status || ' -> cancelled'; end if;
  if v_reason is null or char_length(v_reason) not between 5 and 500 then raise exception 'REASON_REQUIRED'; end if;
  perform 1 from public.orders where id = v_inv.order_id for update;
  select coalesce(sum(amount_fcfa), 0) into v_paid from public.order_payments where order_id = v_inv.order_id and status = 'confirmed';
  if v_inv.status = 'issued' and v_paid > 0 then raise exception 'PAYMENTS_EXIST'; end if;

  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by_email = v_actor, cancel_reason = v_reason where id = p_invoice_id;
  insert into public.invoice_events (invoice_id, event, from_status, to_status, actor_id, actor_email, reason)
  values (p_invoice_id, 'cancelled', v_inv.status, 'cancelled', (select auth.uid()), v_actor, v_reason);
  return public.invoice_summary(p_invoice_id);
end;
$$;
revoke all on function public.cancel_invoice(uuid, text) from public, anon;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;

-- 1.6.e Indicateurs : factures émises sur la période (par date d'émission) et règlement calculé.
create function public.invoices_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or p_from >= p_to then raise exception 'INVALID_PERIOD'; end if;
  return (
    select jsonb_build_object(
      'issued_count',      count(*) filter (where status = 'issued'),
      'cancelled_count',   (select count(*) from public.invoices where status = 'cancelled' and cancelled_at >= p_from and cancelled_at < p_to),
      'draft_count',       (select count(*) from public.invoices where status = 'draft'),
      'invoiced_fcfa',     coalesce(sum(total_fcfa) filter (where status = 'issued'), 0),
      'collected_fcfa',    coalesce(sum(least(paid_fcfa, total_fcfa)) filter (where status = 'issued'), 0),
      'balance_fcfa',      coalesce(sum(greatest(total_fcfa - paid_fcfa, 0)) filter (where status = 'issued'), 0),
      'paid_count',        count(*) filter (where status = 'issued' and paid_fcfa >= total_fcfa),
      'partial_count',     count(*) filter (where status = 'issued' and paid_fcfa > 0 and paid_fcfa < total_fcfa),
      'unpaid_count',      count(*) filter (where status = 'issued' and paid_fcfa = 0),
      'overdue_count',     count(*) filter (where status = 'issued' and paid_fcfa < total_fcfa and due_at is not null and due_at < current_date),
      'overdue_fcfa',      coalesce(sum(greatest(total_fcfa - paid_fcfa, 0)) filter (where status = 'issued' and paid_fcfa < total_fcfa and due_at is not null and due_at < current_date), 0)
    )
    from (
      select i.status, i.total_fcfa, i.due_at,
             coalesce((select sum(p.amount_fcfa) from public.order_payments p where p.order_id = i.order_id and p.status = 'confirmed'), 0) as paid_fcfa
      from public.invoices i where i.issued_at >= p_from and i.issued_at < p_to
    ) t
  );
end;
$$;
revoke all on function public.invoices_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.invoices_summary(timestamptz, timestamptz) to authenticated;

commit;


-- =====================================================================
-- PARTIE 2 — VÉRIFICATIONS APRÈS APPLICATION (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'fonctions de facturation: authenticated oui, anon non' as controle,
       (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
        from unnest(array['public.create_invoice_draft(uuid)', 'public.update_invoice_draft(uuid,text,text,text,text,date,text)', 'public.issue_invoice(uuid)', 'public.cancel_invoice(uuid,text)', 'public.invoices_summary(timestamptz,timestamptz)']) f) as ok
union all select 'invoice_summary interne (aucun rôle API)', not has_function_privilege('authenticated', 'public.invoice_summary(uuid)', 'execute') and not has_function_privilege('anon', 'public.invoice_summary(uuid)', 'execute')
union all select 'fonctions SECURITY DEFINER avec search_path fixé',
       (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('create_invoice_draft','update_invoice_draft','issue_invoice','cancel_invoice','invoices_summary','invoice_summary') and prosecdef and proconfig::text like '%search_path%') = 6
union all select 'aucune écriture directe sur les factures',
       not has_table_privilege('authenticated', 'public.invoices', 'insert') and not has_table_privilege('authenticated', 'public.invoices', 'update') and not has_table_privilege('authenticated', 'public.invoices', 'delete')
         and not has_table_privilege('authenticated', 'public.invoice_lines', 'insert') and not has_table_privilege('authenticated', 'public.invoice_events', 'insert')
union all select 'compteur inaccessible aux rôles API', not has_table_privilege('authenticated', 'public.invoice_counters', 'select') and not has_table_privilege('authenticated', 'public.invoice_counters', 'update')
union all select 'anon sans aucun accès',
       not has_table_privilege('anon', 'public.invoices', 'select') and not has_table_privilege('anon', 'public.v_invoices', 'select') and not has_table_privilege('anon', 'public.company_settings', 'select')
union all select 'RLS actif sur les 5 tables', (select bool_and(relrowsecurity) from pg_class where relnamespace='public'::regnamespace and relname in ('company_settings','invoice_counters','invoices','invoice_lines','invoice_events'))
union all select 'réglages entreprise vides (rien d''inventé)', (select company_name is null and tax_id is null and rccm is null and address is null from public.company_settings)
union all select 'aucune facture (rien d''inventé)', (select count(*) from public.invoices) = 0;


-- =====================================================================
-- PARTIE 3 — SCÉNARIOS DE TEST (tout est ANNULÉ automatiquement)
-- Le bloc se termine volontairement par l'erreur « RESULTATS DES TESTS » : PostgreSQL annule alors toute la transaction
-- (commandes, factures, paiements, réglages de test). Le rapport est dans le message d'erreur : chaque ligne doit finir par OK.
-- Seule trace durable : les séquences de références de commandes et de reçus avancent de quelques numéros.
-- NE JAMAIS retirer, déplacer ni conditionner le « raise exception » final : c'est lui qui annule les écritures de test
-- (dont la modification temporaire de company_settings). À n'exécuter qu'après la PARTIE 1 de ce fichier.
-- Prérequis : un produit publié dans une catégorie active, 1 administrateur.
-- =====================================================================
do $$
declare
  v_admin uuid := (select user_id from public.admin_users limit 1);
  v_pid   uuid := (select id from public.products where is_published limit 1);
  v_items jsonb;
  o1 jsonb; o2 jsonb; o3 jsonb; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid;
  v_t1 int; v_t2 int;
  d1 jsonb; d2 jsonb; d3 jsonb; i1 jsonb; i2 jsonb; i3 jsonb; c1 jsonb; v_pm jsonb;
  v_n1 text; v_n2 text; v_cnt int; v_stock0 int; v_stock1 int; v_ostatus0 text; v_ostatus1 text;
  v_row record;
  v_report text := '';
begin
  insert into public.delivery_fees (commune, fee_fcfa) values ('Zone Test', 1000) on conflict (commune) do nothing;
  insert into public.product_inventory (product_id, stock_quantity) values (v_pid, 80) on conflict (product_id) do update set stock_quantity = 80;
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 2));
  set local role anon;
  o1 := public.create_order(gen_random_uuid(), 'Client Facture', 'facture@example.com', '0700000301', 'delivery', 'Zone Test', '12 rue des tests', null, v_items, '');
  o2 := public.create_order(gen_random_uuid(), 'Client Deux', 'deux@example.com', '0700000302', 'pickup', null, null, null, v_items, '');
  o3 := public.create_order(gen_random_uuid(), 'Client Trois', 'trois@example.com', '0700000303', 'pickup', null, null, null, v_items, '');
  reset role;
  select id, total_fcfa into v_o1, v_t1 from public.orders where reference = o1->>'reference';
  select id, total_fcfa into v_o2, v_t2 from public.orders where reference = o2->>'reference';
  select id into v_o3 from public.orders where reference = o3->>'reference';
  select stock_quantity into v_stock0 from public.product_inventory where product_id = v_pid;
  select status into v_ostatus0 from public.orders where id = v_o1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'agent@test.example')::text, true);
  set local role authenticated;

  -- 1. Brouillon : données lues en base, aucun numéro, lignes copiées
  d1 := public.create_invoice_draft(v_o1);
  reset role;
  select * into v_row from public.invoices where id = (d1->>'id')::uuid;
  select count(*) into v_cnt from public.invoice_lines where invoice_id = v_row.id;
  v_report := v_report || format(E'1 brouillon: statut=%s numéro=%s total=%s (commande %s) lignes=%s adresse=%s -> %s\n', v_row.status, coalesce(v_row.number, 'aucun'), v_row.total_fcfa, v_t1, v_cnt, v_row.billing_address,
    case when v_row.status = 'draft' and v_row.number is null and v_row.total_fcfa = v_t1 and v_cnt = 1 and v_row.billing_address = '12 rue des tests, Zone Test' then 'OK' else 'ECHEC' end);
  set local role authenticated;

  -- 2. Protection contre la double création
  d2 := public.create_invoice_draft(v_o1);
  v_report := v_report || format(E'2 double création: même facture=%s already_exists=%s -> %s\n', (d2->>'id') = (d1->>'id'), d2->>'already_exists', case when (d2->>'id') = (d1->>'id') and d2->>'already_exists' = 'true' then 'OK' else 'ECHEC' end);

  -- 3. Émission impossible sans réglages d'entreprise ; puis réglages, correction du brouillon, émission
  begin perform public.issue_invoice((d1->>'id')::uuid); v_report := v_report || E'3a sans entreprise: ECHEC\n';
  exception when others then v_report := v_report || format(E'3a émission sans nom d''entreprise: %s -> %s\n', sqlerrm, case when sqlerrm = 'COMPANY_SETTINGS_REQUIRED' then 'OK' else 'ECHEC' end); end;
  update public.company_settings set company_name = 'Entreprise de Test', due_days = 15, legal_notice = 'Mention de test', tax_id = 'TEST-FISCAL-000';
  d2 := public.update_invoice_draft((d1->>'id')::uuid, 'Client Facture Corrigé', 'facture@example.com', '0700000301', '12 rue des tests, Zone Test', null, 'note interne');
  i1 := public.issue_invoice((d1->>'id')::uuid);
  v_n1 := i1->>'number';
  select * into v_row from public.invoices where id = (d1->>'id')::uuid;
  v_report := v_report || format(E'3b émission: numéro=%s statut=%s échéance=%s (attendu %s) entreprise=%s client=%s -> %s\n', v_n1, i1->>'status', i1->>'due_at', current_date + 15, v_row.company_snapshot->>'company_name', v_row.customer_name,
    case when v_n1 ~ ('^MH-FACT-' || extract(year from current_date)::int || '-000001$') and i1->>'status' = 'issued' and (i1->>'due_at')::date = current_date + 15 and v_row.company_snapshot->>'tax_id' = 'TEST-FISCAL-000' and v_row.customer_name = 'Client Facture Corrigé' then 'OK' else 'ECHEC' end);

  -- 4. Double émission refusée ; modification d'un brouillon refusée après émission
  begin perform public.issue_invoice((d1->>'id')::uuid); v_report := v_report || E'4a double émission: ECHEC\n';
  exception when others then v_report := v_report || format(E'4a double émission: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_NOT_DRAFT' then 'OK' else 'ECHEC' end); end;
  begin perform public.update_invoice_draft((d1->>'id')::uuid, 'Autre nom', null, null, null, null, null); v_report := v_report || E'4b modification après émission: ECHEC\n';
  exception when others then v_report := v_report || format(E'4b modification après émission: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_NOT_DRAFT' then 'OK' else 'ECHEC' end); end;

  -- 5. Numérotation séquentielle : la facture suivante porte le numéro suivant
  d3 := public.create_invoice_draft(v_o2);
  i2 := public.issue_invoice((d3->>'id')::uuid);
  v_n2 := i2->>'number';
  v_report := v_report || format(E'5 numérotation: %s puis %s -> %s\n', v_n1, v_n2, case when v_n2 ~ ('^MH-FACT-' || extract(year from current_date)::int || '-000002$') and v_n1 <> v_n2 then 'OK' else 'ECHEC' end);

  -- 6. Règlement calculé : partiel puis total (paiements CONFIRMÉS uniquement)
  v_pm := public.record_payment(v_o1, v_t1 / 4, 'mobile_money', 'MM-FACT-0001', now(), null, gen_random_uuid(), false);
  select * into v_row from public.v_invoices where id = (d1->>'id')::uuid;
  v_report := v_report || format(E'6a paiement en attente seulement: payé=%s statut=%s -> %s\n', v_row.paid_fcfa, v_row.display_status, case when v_row.paid_fcfa = 0 and v_row.display_status = 'issued' then 'OK' else 'ECHEC' end);
  perform public.record_payment(v_o1, v_t1 / 4, 'cash', null, now(), null, gen_random_uuid(), true);
  select * into v_row from public.v_invoices where id = (d1->>'id')::uuid;
  v_report := v_report || format(E'6b paiement partiel confirmé: payé=%s solde=%s statut=%s -> %s\n', v_row.paid_fcfa, v_row.balance_fcfa, v_row.display_status, case when v_row.paid_fcfa = v_t1 / 4 and v_row.balance_fcfa = v_t1 - v_t1 / 4 and v_row.display_status = 'partially_paid' then 'OK' else 'ECHEC' end);
  -- Le paiement en attente réserve une part du solde : on l'annule (trace conservée) avant de solder en espèces.
  perform public.set_payment_status((v_pm->>'id')::uuid, 'cancelled', 'Saisie de test annulée');
  perform public.record_payment(v_o1, v_t1 - v_t1 / 4, 'cash', null, now(), null, gen_random_uuid(), true);
  select * into v_row from public.v_invoices where id = (d1->>'id')::uuid;
  v_report := v_report || format(E'6c paiement final: payé=%s solde=%s statut=%s -> %s\n', v_row.paid_fcfa, v_row.balance_fcfa, v_row.display_status, case when v_row.paid_fcfa = v_t1 and v_row.balance_fcfa = 0 and v_row.display_status = 'paid' then 'OK' else 'ECHEC' end);

  -- 7. Annulation : refusée si des paiements confirmés existent ; motif obligatoire ; numéro conservé ; trace
  begin perform public.cancel_invoice((d1->>'id')::uuid, 'Erreur de facturation'); v_report := v_report || E'7a annulation avec paiements: ECHEC\n';
  exception when others then v_report := v_report || format(E'7a annulation d''une facture réglée: %s -> %s\n', sqlerrm, case when sqlerrm = 'PAYMENTS_EXIST' then 'OK' else 'ECHEC' end); end;
  begin perform public.cancel_invoice((d3->>'id')::uuid, 'x'); v_report := v_report || E'7b sans motif: ECHEC\n';
  exception when others then v_report := v_report || format(E'7b annulation sans motif: %s -> %s\n', sqlerrm, case when sqlerrm = 'REASON_REQUIRED' then 'OK' else 'ECHEC' end); end;
  c1 := public.cancel_invoice((d3->>'id')::uuid, 'Client ayant changé de commande');
  select * into v_row from public.invoices where id = (d3->>'id')::uuid;
  select count(*) into v_cnt from public.invoice_events where invoice_id = v_row.id;
  v_report := v_report || format(E'7c annulation traçable: statut=%s numéro conservé=%s motif=%s événements=%s -> %s\n', c1->>'status', v_row.number, v_row.cancel_reason, v_cnt,
    case when c1->>'status' = 'cancelled' and v_row.number = v_n2 and v_row.cancel_reason is not null and v_cnt = 3 then 'OK' else 'ECHEC' end);
  begin perform public.issue_invoice((d3->>'id')::uuid); v_report := v_report || E'7d réémission d''une annulée: ECHEC\n';
  exception when others then v_report := v_report || format(E'7d réémission d''une facture annulée: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_NOT_DRAFT' then 'OK' else 'ECHEC' end); end;
  begin perform public.cancel_invoice((d3->>'id')::uuid, 'Seconde annulation'); v_report := v_report || E'7e double annulation: ECHEC\n';
  exception when others then v_report := v_report || format(E'7e double annulation: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_TRANSITION' then 'OK' else 'ECHEC' end); end;

  -- 8. Correction : nouvelle facture pour la commande annulée, qui référence l'ancienne ; le numéro annulé n'est jamais réutilisé
  d3 := public.create_invoice_draft(v_o2);
  i3 := public.issue_invoice((d3->>'id')::uuid);
  select replaces_number into v_n2 from public.v_invoices where id = (d3->>'id')::uuid;
  v_report := v_report || format(E'8 remplacement: nouveau numéro=%s remplace=%s -> %s\n', i3->>'number', v_n2,
    case when i3->>'number' ~ '-000003$' and v_n2 ~ '-000002$' then 'OK' else 'ECHEC' end);

  -- 9. Instantané : modifier le catalogue et la commande ne change pas la facture émise
  reset role;
  update public.products set name = 'NOM MODIFIÉ APRÈS ÉMISSION' where id = v_pid;
  update public.orders set customer_name = 'NOM CLIENT MODIFIÉ' where id = v_o1;
  update public.company_settings set company_name = 'Entreprise Modifiée';
  select l.description into v_n2 from public.invoice_lines l where l.invoice_id = (d1->>'id')::uuid limit 1;
  select customer_name, company_snapshot into v_row from public.invoices where id = (d1->>'id')::uuid;
  v_report := v_report || format(E'9 instantané conservé: ligne=%s client=%s entreprise=%s -> %s\n', v_n2, v_row.customer_name, v_row.company_snapshot->>'company_name', case when v_n2 <> 'NOM MODIFIÉ APRÈS ÉMISSION' and v_row.customer_name = 'Client Facture Corrigé' then 'OK' else 'ECHEC' end);

  -- 10. Immuabilité, même pour le propriétaire de la base
  begin update public.invoices set total_fcfa = 1, subtotal_fcfa = 1, delivery_fee_fcfa = 0 where id = (d1->>'id')::uuid; v_report := v_report || E'10a montant: ECHEC\n';
  exception when others then v_report := v_report || format(E'10a modification des montants: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_IMMUTABLE' then 'OK' else 'ECHEC' end); end;
  begin update public.invoices set customer_name = 'Autre' where id = (d1->>'id')::uuid; v_report := v_report || E'10b client: ECHEC\n';
  exception when others then v_report := v_report || format(E'10b modification du client après émission: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_IMMUTABLE' then 'OK' else 'ECHEC' end); end;
  begin delete from public.invoices where id = (d1->>'id')::uuid; v_report := v_report || E'10c suppression: ECHEC\n';
  exception when others then v_report := v_report || format(E'10c suppression: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_DELETE_FORBIDDEN' then 'OK' else 'ECHEC' end); end;
  begin update public.invoice_lines set quantity = 9 where invoice_id = (d1->>'id')::uuid; v_report := v_report || E'10d lignes: ECHEC\n';
  exception when others then v_report := v_report || format(E'10d modification des lignes: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_RECORD_IMMUTABLE' then 'OK' else 'ECHEC' end); end;
  begin update public.invoice_events set reason = 'x'; v_report := v_report || E'10e historique: ECHEC\n';
  exception when others then v_report := v_report || format(E'10e modification de l''historique: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVOICE_RECORD_IMMUTABLE' then 'OK' else 'ECHEC' end); end;

  -- 11. En retard : facture émise dont l'échéance est dépassée (insérée directement pour simuler le temps), solde dû
  insert into public.invoices (id, number, order_id, status, issued_at, due_at, customer_name, fulfillment_method, subtotal_fcfa, delivery_fee_fcfa, total_fcfa)
    select gen_random_uuid(), 'TEST-RETARD-1', v_o3, 'issued', now() - interval '30 days', current_date - 5, 'Client Trois', 'pickup', subtotal_fcfa, delivery_fee_fcfa, total_fcfa from public.orders where id = v_o3;
  select * into v_row from public.v_invoices where number = 'TEST-RETARD-1';
  v_report := v_report || format(E'11 échéance dépassée et solde dû: statut=%s en retard=%s -> %s\n', v_row.display_status, v_row.is_overdue, case when v_row.display_status = 'overdue' and v_row.is_overdue then 'OK' else 'ECHEC' end);

  -- 12. Permissions
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'intrus@test.example')::text, true);
  set local role authenticated;
  begin perform public.create_invoice_draft(v_o3); v_report := v_report || E'12a non-admin: ECHEC\n';
  exception when others then v_report := v_report || format(E'12a non-administrateur: %s -> %s\n', sqlerrm, case when sqlerrm = 'FORBIDDEN' then 'OK' else 'ECHEC' end); end;
  select count(*) into v_cnt from public.v_invoices;
  v_report := v_report || format(E'12b lecture des factures par un non-admin: %s ligne(s) -> %s\n', v_cnt, case when v_cnt = 0 then 'OK' else 'ECHEC' end);
  reset role;
  set local role anon;
  begin perform public.create_invoice_draft(v_o3); v_report := v_report || E'12c visiteur: ECHEC\n';
  exception when others then v_report := v_report || E'12c visiteur anonyme : exécution refusée -> OK\n'; end;
  reset role;

  -- 13. Aucune régression : le stock et le statut de la commande ne changent jamais
  select stock_quantity into v_stock1 from public.product_inventory where product_id = v_pid;
  select status into v_ostatus1 from public.orders where id = v_o1;
  v_report := v_report || format(E'13 stock %s -> %s, statut commande %s -> %s -> %s\n', v_stock0, v_stock1, v_ostatus0, v_ostatus1, case when v_stock0 = v_stock1 and v_ostatus0 = v_ostatus1 then 'OK' else 'ECHEC' end);

  -- 14. Commande annulée : pas de facture
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'agent@test.example')::text, true);
  set local role anon;
  o3 := public.create_order(gen_random_uuid(), 'Client Quatre', 'quatre@example.com', '0700000304', 'pickup', null, null, null, v_items, '');
  reset role;
  select id into v_o4 from public.orders where reference = o3->>'reference';
  set local role authenticated;
  perform public.admin_set_order_status(v_o4, 'cancelled');
  begin perform public.create_invoice_draft(v_o4); v_report := v_report || E'14 commande annulée: ECHEC\n';
  exception when others then v_report := v_report || format(E'14 facture sur commande annulée: %s -> %s\n', sqlerrm, case when sqlerrm = 'ORDER_CANCELLED' then 'OK' else 'ECHEC' end); end;

  -- 15. Indicateurs cohérents avec les lignes
  c1 := public.invoices_summary(now() - interval '1 day', now() + interval '1 day');
  reset role;
  select count(*) into v_cnt from public.invoices where status = 'issued' and number not like 'TEST-%';
  v_report := v_report || format(E'15 indicateurs: émises=%s (lignes émises de la période=%s) facturé=%s encaissé=%s solde=%s -> %s\n', c1->>'issued_count', v_cnt, c1->>'invoiced_fcfa', c1->>'collected_fcfa', c1->>'balance_fcfa',
    case when (c1->>'issued_count')::int = v_cnt and (c1->>'collected_fcfa')::int = v_t1 and (c1->>'invoiced_fcfa')::int >= v_t1 then 'OK' else 'ECHEC' end);

  raise exception E'RESULTATS DES TESTS (tout est annule)\n%', v_report;
end $$;


-- =====================================================================
-- PARTIE 4 — RETOUR ARRIÈRE (à n'utiliser que si la migration doit être défaite)
-- LIMITES : supprime TOUTES les factures, leurs lignes, leur historique, le compteur et les coordonnées de l'entreprise.
-- Ne jamais l'exécuter si des factures ont été émises et remises à des clients (perte de pièces comptables) : exportez d'abord.
-- =====================================================================
-- begin;
--   drop function if exists public.invoices_summary(timestamptz, timestamptz);
--   drop function if exists public.cancel_invoice(uuid, text);
--   drop function if exists public.issue_invoice(uuid);
--   drop function if exists public.update_invoice_draft(uuid, text, text, text, text, date, text);
--   drop function if exists public.create_invoice_draft(uuid);
--   drop function if exists public.invoice_summary(uuid);
--   drop view if exists public.v_invoices;
--   drop table if exists public.invoice_events;
--   drop table if exists public.invoice_lines;
--   drop table if exists public.invoices;
--   drop table if exists public.invoice_counters;
--   drop table if exists public.company_settings;
--   drop function if exists public.invoices_guard();
-- commit;
