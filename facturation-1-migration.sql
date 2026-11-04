-- MERITT HOME — Module de facturation : MIGRATION (PARTIE 1 de migration-factures.sql, copiée à l'identique)
-- Projet Supabase de production : jvmvsaiduralhezrjeyg
--
-- MODIFIE LA BASE. À exécuter UNE SEULE FOIS, et seulement si facturation-0-etat-avant.sql renvoie ok = true partout.
-- Transaction unique (begin ... commit) : en cas d'erreur, rien n'est créé. Non idempotente : ne jamais la rejouer.
-- Crée uniquement de NOUVEAUX objets (5 tables, 1 vue, 7 fonctions, 5 triggers, index, 4 politiques RLS, droits).
-- Ne modifie ni ne supprime aucune table, ligne, politique ou fonction existante (commandes et paiements inclus).
-- Les lignes ci-dessous sont identiques aux lignes 45 à 451 de migration-factures.sql.
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
