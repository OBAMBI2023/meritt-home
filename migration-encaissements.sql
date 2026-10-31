-- =====================================================================
-- MERITT HOME — Module d'encaissement : migration additive (PROPOSITION)
-- Projet Supabase de production : jvmvsaiduralhezrjeyg
--
-- STATUT : NON APPLIQUÉE, NON EXÉCUTÉE sur Supabase. À relire puis à appliquer manuellement.
-- Prérequis : migration-commandes.sql (PARTIE 1) déjà appliquée (fonctions is_admin, tables orders/order_items,
--             colonne orders.fulfillment_method...). Validée sur PostgreSQL en mémoire (PGlite).
--
-- Principes :
--   * aucune table de paiement n'existait : on en crée une, sans toucher à orders.payment_method (reste « cash_on_delivery »
--     = choix du client) ni aux statuts de commande / de préparation / de livraison ;
--   * toutes les écritures passent par des fonctions SECURITY DEFINER réservées aux administrateurs (is_admin()) ;
--     les tables ne sont lisibles qu'en lecture par les administrateurs : aucun droit INSERT / UPDATE / DELETE pour les clients API ;
--   * un paiement n'est « confirmé » que par une action explicite d'un administrateur ; Mobile Money, virement et « autre » ne
--     peuvent jamais être confirmés au moment de la saisie ;
--   * aucun paiement n'est supprimé ni modifié dans son montant : annulation = changement de statut tracé (contrepassation) ;
--   * le stock n'est jamais touché ;
--   * orders.payment_status passe à 'paid' seulement quand la somme des paiements CONFIRMÉS couvre le total de la commande,
--     et revient à 'pending' si une contrepassation fait repasser sous le total. Valeurs autorisées existantes : inchangées.
--
-- Contenu : PARTIE 0 contrôles préalables · 1 migration · 2 vérifications · 3 tests (annulés automatiquement) · 4 retour arrière
-- =====================================================================


-- =====================================================================
-- PARTIE 0 — CONTRÔLES PRÉALABLES (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'migration commandes appliquée (fulfillment_method)' as controle,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='fulfillment_method') as ok
union all select 'is_admin() existe',            exists (select 1 from pg_proc where proname='is_admin' and pronamespace='public'::regnamespace)
union all select 'set_updated_at() existe',      exists (select 1 from pg_proc where proname='set_updated_at' and pronamespace='public'::regnamespace)
union all select 'admin_set_order_status existe', exists (select 1 from pg_proc where proname='admin_set_order_status' and pronamespace='public'::regnamespace)
union all select 'tables de paiement absentes',  not exists (select 1 from information_schema.tables where table_schema='public' and table_name in ('payment_methods','order_payments','order_payment_events'))
union all select 'orders.payment_status accepte paid', (select pg_get_constraintdef(oid) like '%paid%' from pg_constraint where conname='orders_payment_status_check');


-- =====================================================================
-- PARTIE 1 — MIGRATION
-- =====================================================================
begin;

create sequence public.payment_receipt_seq;

-- ---------------------------------------------------------------------
-- 1.1 Moyens de paiement configurables.
--     requires_verification = true : le paiement ne peut JAMAIS être confirmé à la saisie (Mobile Money, virement, autre).
--     Seules les lignes demandées dans le cahier des charges sont créées ; d'autres moyens peuvent être ajoutés ensuite.
-- ---------------------------------------------------------------------
create table public.payment_methods (
  code                  text primary key check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  label                 text not null check (char_length(btrim(label)) between 2 and 60),
  requires_verification boolean not null,
  requires_reference    boolean not null default false,
  is_active             boolean not null default true,
  sort_order            int4 not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
insert into public.payment_methods (code, label, requires_verification, requires_reference, sort_order) values
  ('cash',          'Espèces',          false, false, 10),
  ('mobile_money',  'Mobile Money',     true,  true,  20),
  ('bank_transfer', 'Virement bancaire', true, true,  30),
  ('other',         'Autre moyen',      true,  false, 40);

create trigger payment_methods_set_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 1.2 Paiements : une ligne par versement, jamais supprimée.
-- ---------------------------------------------------------------------
create table public.order_payments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete restrict,
  amount_fcfa        int4 not null check (amount_fcfa > 0),
  method_code        text not null references public.payment_methods(code) on delete restrict,
  external_reference text check (external_reference is null or char_length(btrim(external_reference)) between 3 and 80),
  paid_at            timestamptz not null,
  note               text check (note is null or char_length(note) <= 500),
  status             text not null default 'pending_confirmation'
                     check (status in ('pending_confirmation', 'confirmed', 'rejected', 'cancelled', 'reversed')),
  receipt_number     text unique,
  idempotency_key    uuid not null unique,
  recorded_by        uuid references auth.users(id) on delete set null,
  recorded_by_email  text,
  confirmed_by       uuid references auth.users(id) on delete set null,
  confirmed_by_email text,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Un reçu existe exactement pour les paiements confirmés (et conservés après contrepassation).
  constraint order_payments_receipt_check check ((status in ('confirmed', 'reversed')) = (receipt_number is not null))
);
create index order_payments_order_idx on public.order_payments (order_id);
create index order_payments_created_idx on public.order_payments (created_at desc);
create index order_payments_status_idx on public.order_payments (status);
-- Même transaction externe (méthode + référence) jamais enregistrée deux fois tant qu'elle est en attente ou confirmée.
create unique index order_payments_reference_key on public.order_payments (method_code, lower(btrim(external_reference)))
  where external_reference is not null and status in ('pending_confirmation', 'confirmed');

create trigger order_payments_set_updated_at
  before update on public.order_payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 1.3 Historique des changements de statut (ajout seul : jamais modifié ni supprimé).
-- ---------------------------------------------------------------------
create table public.order_payment_events (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.order_payments(id) on delete restrict,
  from_status text,
  to_status   text not null,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  reason      text check (reason is null or char_length(reason) <= 500),
  created_at  timestamptz not null default now()
);
create index order_payment_events_payment_idx on public.order_payment_events (payment_id, created_at);

-- Garde-fous : même un accès direct ne peut supprimer ni altérer un paiement ou son historique.
create function public.payments_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'order_payment_events' then
    raise exception 'PAYMENT_HISTORY_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'PAYMENT_DELETE_FORBIDDEN';
  end if;
  if new.order_id is distinct from old.order_id
     or new.amount_fcfa is distinct from old.amount_fcfa
     or new.method_code is distinct from old.method_code
     or new.paid_at is distinct from old.paid_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'PAYMENT_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function public.payments_guard() from public, anon, authenticated;
create trigger order_payments_guard before update or delete on public.order_payments
  for each row execute function public.payments_guard();
create trigger order_payment_events_guard before update or delete on public.order_payment_events
  for each row execute function public.payments_guard();

-- ---------------------------------------------------------------------
-- 1.4 RLS : lecture réservée aux administrateurs ; aucune écriture directe pour les clients API.
-- ---------------------------------------------------------------------
alter table public.payment_methods enable row level security;
alter table public.order_payments enable row level security;
alter table public.order_payment_events enable row level security;

create policy "Admins manage payment methods" on public.payment_methods
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins read payments" on public.order_payments
  for select to authenticated using ((select public.is_admin()));
create policy "Admins read payment events" on public.order_payment_events
  for select to authenticated using ((select public.is_admin()));

revoke all on public.payment_methods, public.order_payments, public.order_payment_events from anon, authenticated;
grant select, insert, update on public.payment_methods to authenticated;
grant select on public.order_payments to authenticated;
grant select on public.order_payment_events to authenticated;

-- ---------------------------------------------------------------------
-- 1.5 Vue de lecture : paiement + commande + client + solde (applique la RLS de l'appelant).
-- ---------------------------------------------------------------------
create view public.v_order_payments with (security_invoker = true) as
select
  p.id, p.order_id, o.reference as order_reference, o.customer_name, o.customer_phone,
  o.total_fcfa as order_total_fcfa, o.payment_status as order_payment_status,
  p.amount_fcfa, p.method_code, m.label as method_label, p.external_reference, p.paid_at, p.note,
  p.status, p.receipt_number, p.recorded_by_email, p.confirmed_by_email, p.confirmed_at, p.created_at,
  coalesce((select sum(c.amount_fcfa) from public.order_payments c where c.order_id = p.order_id and c.status = 'confirmed'), 0)::int4 as order_confirmed_fcfa
from public.order_payments p
join public.orders o on o.id = p.order_id
join public.payment_methods m on m.code = p.method_code;
revoke all on public.v_order_payments from anon, authenticated;
grant select on public.v_order_payments to authenticated;

-- ---------------------------------------------------------------------
-- 1.6 Fonctions internes (non exposées aux rôles API)
-- ---------------------------------------------------------------------
create function public.payment_summary(p_payment_id uuid) returns jsonb
language sql security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'order_id', o.id, 'order_reference', o.reference,
    'amount_fcfa', p.amount_fcfa, 'method_code', p.method_code, 'status', p.status, 'receipt_number', p.receipt_number,
    'order_total_fcfa', o.total_fcfa, 'order_payment_status', o.payment_status,
    'confirmed_total_fcfa', c.s, 'balance_fcfa', o.total_fcfa - c.s)
  from public.order_payments p
  join public.orders o on o.id = p.order_id
  cross join lateral (select coalesce(sum(x.amount_fcfa), 0)::int4 as s from public.order_payments x where x.order_id = o.id and x.status = 'confirmed') c
  where p.id = p_payment_id;
$$;
revoke all on function public.payment_summary(uuid) from public, anon, authenticated;

-- Statut de paiement de la commande : « paid » seulement si les paiements CONFIRMÉS couvrent le total.
create function public.payment_recalc_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_total  int4;
  v_status text;
  v_paid   int8;
begin
  select total_fcfa, payment_status into v_total, v_status from public.orders where id = p_order_id;
  select coalesce(sum(amount_fcfa), 0) into v_paid from public.order_payments where order_id = p_order_id and status = 'confirmed';
  if v_paid >= v_total and v_status in ('unpaid', 'pending') then
    update public.orders set payment_status = 'paid' where id = p_order_id;
  elsif v_paid < v_total and v_status = 'paid' then
    update public.orders set payment_status = 'pending' where id = p_order_id;
  end if;
end;
$$;
revoke all on function public.payment_recalc_order(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.7 record_payment : enregistre un versement (en attente, ou confirmé si espèces et confirmation demandée).
--     Codes d'erreur (error.message) : FORBIDDEN, INVALID_REQUEST, INVALID_AMOUNT, INVALID_METHOD, REFERENCE_REQUIRED,
--     INVALID_REFERENCE, INVALID_DATE, INVALID_NOTE, ORDER_NOT_FOUND, ORDER_CANCELLED, AMOUNT_EXCEEDS_BALANCE,
--     VERIFICATION_REQUIRED, DUPLICATE_REFERENCE
-- ---------------------------------------------------------------------
create function public.record_payment(
  p_order_id        uuid,
  p_amount          int4,
  p_method          text,
  p_reference       text,
  p_paid_at         timestamptz,
  p_note            text,
  p_idempotency_key uuid,
  p_confirm         boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order     public.orders%rowtype;
  v_method    public.payment_methods%rowtype;
  v_ref       text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_paid_at   timestamptz := coalesce(p_paid_at, now());
  v_confirmed int8;
  v_pending   int8;
  v_existing  uuid;
  v_id        uuid;
  v_email     text := (select auth.jwt() ->> 'email');
  v_status    text;
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  if p_order_id is null or p_idempotency_key is null then raise exception 'INVALID_REQUEST'; end if;

  -- Double envoi : la même clé renvoie le même paiement, sans rien dupliquer.
  perform pg_advisory_xact_lock(hashtextextended('mh-payment-key:' || p_idempotency_key::text, 0));
  select p.id into v_existing from public.order_payments p where p.idempotency_key = p_idempotency_key;
  if found then
    return public.payment_summary(v_existing) || jsonb_build_object('idempotent_replay', true);
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  select * into v_method from public.payment_methods where code = p_method and is_active;
  if not found then raise exception 'INVALID_METHOD'; end if;
  if v_method.requires_reference and v_ref is null then raise exception 'REFERENCE_REQUIRED'; end if;
  if v_ref is not null and char_length(v_ref) not between 3 and 80 then raise exception 'INVALID_REFERENCE'; end if;
  if v_paid_at > now() + interval '10 minutes' then raise exception 'INVALID_DATE'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'INVALID_NOTE'; end if;
  if p_confirm and v_method.requires_verification then raise exception 'VERIFICATION_REQUIRED'; end if;

  -- Verrou de la commande : deux paiements simultanés sur la même commande sont sérialisés.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;

  select coalesce(sum(amount_fcfa) filter (where status = 'confirmed'), 0),
         coalesce(sum(amount_fcfa) filter (where status = 'pending_confirmation'), 0)
    into v_confirmed, v_pending
    from public.order_payments where order_id = p_order_id;
  -- Pas de surpaiement : le total des paiements confirmés et en attente ne peut pas dépasser le total dû.
  if p_amount > v_order.total_fcfa - v_confirmed - v_pending then
    raise exception 'AMOUNT_EXCEEDS_BALANCE' using detail = 'maximum ' || (v_order.total_fcfa - v_confirmed - v_pending)::text;
  end if;

  if v_ref is not null and exists (
    select 1 from public.order_payments
    where method_code = p_method and lower(btrim(external_reference)) = lower(v_ref) and status in ('pending_confirmation', 'confirmed')
  ) then
    raise exception 'DUPLICATE_REFERENCE';
  end if;

  v_status := case when p_confirm then 'confirmed' else 'pending_confirmation' end;
  insert into public.order_payments (
    order_id, amount_fcfa, method_code, external_reference, paid_at, note, status, idempotency_key,
    recorded_by, recorded_by_email,
    receipt_number, confirmed_by, confirmed_by_email, confirmed_at)
  values (
    p_order_id, p_amount, p_method, v_ref, v_paid_at, v_note, v_status, p_idempotency_key,
    (select auth.uid()), v_email,
    case when p_confirm then 'RC-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.payment_receipt_seq')::text, 6, '0') end,
    case when p_confirm then (select auth.uid()) end,
    case when p_confirm then v_email end,
    case when p_confirm then now() end)
  returning id into v_id;

  insert into public.order_payment_events (payment_id, from_status, to_status, actor_id, actor_email, reason)
  values (v_id, null, v_status, (select auth.uid()), v_email, case when p_confirm then 'Espèces encaissées et confirmées à la saisie' else 'Paiement enregistré, en attente de vérification' end);

  perform public.payment_recalc_order(p_order_id);
  return public.payment_summary(v_id);
end;
$$;
revoke all on function public.record_payment(uuid, int4, text, text, timestamptz, text, uuid, boolean) from public, anon;
grant execute on function public.record_payment(uuid, int4, text, text, timestamptz, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 1.8 confirm_payment : confirmation explicite d'un paiement en attente (attestation obligatoire).
--     Codes : FORBIDDEN, ATTESTATION_REQUIRED, PAYMENT_NOT_FOUND, INVALID_TRANSITION, ORDER_CANCELLED, AMOUNT_EXCEEDS_BALANCE
-- ---------------------------------------------------------------------
create function public.confirm_payment(p_payment_id uuid, p_attest boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order_id  uuid;
  v_order     public.orders%rowtype;
  v_payment   public.order_payments%rowtype;
  v_confirmed int8;
  v_email     text := (select auth.jwt() ->> 'email');
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  if p_attest is distinct from true then raise exception 'ATTESTATION_REQUIRED'; end if;

  select order_id into v_order_id from public.order_payments where id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  -- Même ordre de verrouillage que record_payment : commande d'abord, puis paiement.
  select * into v_order from public.orders where id = v_order_id for update;
  select * into v_payment from public.order_payments where id = p_payment_id for update;

  if v_payment.status <> 'pending_confirmation' then
    raise exception 'INVALID_TRANSITION' using detail = v_payment.status || ' -> confirmed';
  end if;
  if v_order.status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;
  select coalesce(sum(amount_fcfa), 0) into v_confirmed from public.order_payments where order_id = v_order_id and status = 'confirmed';
  if v_confirmed + v_payment.amount_fcfa > v_order.total_fcfa then raise exception 'AMOUNT_EXCEEDS_BALANCE'; end if;

  update public.order_payments
     set status = 'confirmed', confirmed_by = (select auth.uid()), confirmed_by_email = v_email, confirmed_at = now(),
         receipt_number = 'RC-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.payment_receipt_seq')::text, 6, '0')
   where id = p_payment_id;
  insert into public.order_payment_events (payment_id, from_status, to_status, actor_id, actor_email, reason)
  values (p_payment_id, 'pending_confirmation', 'confirmed', (select auth.uid()), v_email, 'Vérification attestée par l''administrateur');

  perform public.payment_recalc_order(v_order_id);
  return public.payment_summary(p_payment_id);
end;
$$;
revoke all on function public.confirm_payment(uuid, boolean) from public, anon;
grant execute on function public.confirm_payment(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 1.9 set_payment_status : refus, annulation (paiement en attente) ou contrepassation (paiement confirmé), avec motif.
--     pending_confirmation -> rejected | cancelled ; confirmed -> reversed. Aucune suppression.
--     Codes : FORBIDDEN, PAYMENT_NOT_FOUND, INVALID_TRANSITION, REASON_REQUIRED
-- ---------------------------------------------------------------------
create function public.set_payment_status(p_payment_id uuid, p_new_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order_id uuid;
  v_payment  public.order_payments%rowtype;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email    text := (select auth.jwt() ->> 'email');
  v_min      int4;
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  select order_id into v_order_id from public.order_payments where id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_payment from public.order_payments where id = p_payment_id for update;

  if not ((v_payment.status = 'pending_confirmation' and p_new_status in ('rejected', 'cancelled'))
       or (v_payment.status = 'confirmed' and p_new_status = 'reversed')) then
    raise exception 'INVALID_TRANSITION' using detail = v_payment.status || ' -> ' || coalesce(p_new_status, 'null');
  end if;
  -- Motif obligatoire (5 caractères minimum pour une contrepassation, 3 sinon). Calculé avant le IF : un CASE ... THEN dans la condition tromperait l'analyseur PL/pgSQL.
  v_min := case when p_new_status = 'reversed' then 5 else 3 end;
  if v_reason is null or char_length(v_reason) < v_min or char_length(v_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.order_payments set status = p_new_status where id = p_payment_id;
  insert into public.order_payment_events (payment_id, from_status, to_status, actor_id, actor_email, reason)
  values (p_payment_id, v_payment.status, p_new_status, (select auth.uid()), v_email, v_reason);

  perform public.payment_recalc_order(v_order_id);
  return public.payment_summary(p_payment_id);
end;
$$;
revoke all on function public.set_payment_status(uuid, text, text) from public, anon;
grant execute on function public.set_payment_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 1.10 payments_summary : indicateurs d'une période (par date de paiement) + rapprochement global. Lecture seule, admin.
-- ---------------------------------------------------------------------
create function public.payments_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or p_from >= p_to then raise exception 'INVALID_PERIOD'; end if;
  return jsonb_build_object(
    'confirmed_total_fcfa', coalesce((select sum(amount_fcfa) from public.order_payments where status = 'confirmed' and paid_at >= p_from and paid_at < p_to), 0),
    'confirmed_count',      (select count(*) from public.order_payments where status = 'confirmed' and paid_at >= p_from and paid_at < p_to),
    'pending_total_fcfa',   coalesce((select sum(amount_fcfa) from public.order_payments where status = 'pending_confirmation'), 0),
    'pending_count',        (select count(*) from public.order_payments where status = 'pending_confirmation'),
    -- Reste à encaisser (toutes périodes) : commandes non annulées, total moins paiements confirmés.
    'outstanding_total_fcfa', coalesce((
      select sum(greatest(o.total_fcfa - coalesce(c.s, 0), 0))
      from public.orders o
      left join lateral (select sum(x.amount_fcfa) as s from public.order_payments x where x.order_id = o.id and x.status = 'confirmed') c on true
      where o.status <> 'cancelled'), 0),
    'orders_unpaid_count', (select count(*) from public.orders o where o.status <> 'cancelled'
                              and coalesce((select sum(x.amount_fcfa) from public.order_payments x where x.order_id = o.id and x.status = 'confirmed'), 0) = 0),
    'orders_partial_count', (select count(*) from public.orders o where o.status <> 'cancelled'
                              and coalesce((select sum(x.amount_fcfa) from public.order_payments x where x.order_id = o.id and x.status = 'confirmed'), 0) between 1 and o.total_fcfa - 1),
    'orders_paid_count', (select count(*) from public.orders o where o.status <> 'cancelled'
                              and coalesce((select sum(x.amount_fcfa) from public.order_payments x where x.order_id = o.id and x.status = 'confirmed'), 0) >= o.total_fcfa),
    -- Incohérences éventuelles entre orders.payment_status et les paiements confirmés (doit rester 0).
    'inconsistent_orders_count', (select count(*) from public.orders o
        where (o.payment_status = 'paid') <> (coalesce((select sum(x.amount_fcfa) from public.order_payments x where x.order_id = o.id and x.status = 'confirmed'), 0) >= o.total_fcfa)
          and o.payment_status in ('unpaid', 'pending', 'paid')),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', t.label, 'total_fcfa', t.s, 'count', t.n) order by t.s desc)
                           from (select m.label, sum(p.amount_fcfa)::int8 as s, count(*) as n from public.order_payments p join public.payment_methods m on m.code = p.method_code
                                 where p.status = 'confirmed' and p.paid_at >= p_from and p.paid_at < p_to group by m.label) t), '[]'::jsonb),
    'by_agent', coalesce((select jsonb_agg(jsonb_build_object('agent', t.a, 'total_fcfa', t.s, 'count', t.n) order by t.s desc)
                          from (select coalesce(p.recorded_by_email, 'inconnu') as a, sum(p.amount_fcfa)::int8 as s, count(*) as n from public.order_payments p
                                where p.status = 'confirmed' and p.paid_at >= p_from and p.paid_at < p_to group by 1) t), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', t.d, 'total_fcfa', t.s, 'count', t.n) order by t.d)
                        from (select (p.paid_at at time zone 'UTC')::date as d, sum(p.amount_fcfa)::int8 as s, count(*) as n from public.order_payments p
                              where p.status = 'confirmed' and p.paid_at >= p_from and p.paid_at < p_to group by 1) t), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.payments_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.payments_summary(timestamptz, timestamptz) to authenticated;

commit;


-- =====================================================================
-- PARTIE 2 — VÉRIFICATIONS APRÈS APPLICATION (lecture seule). Attendu : toutes les lignes ok = true.
-- =====================================================================
select 'record_payment: authenticated oui, anon non' as controle,
       has_function_privilege('authenticated', 'public.record_payment(uuid,int4,text,text,timestamptz,text,uuid,boolean)', 'execute')
       and not has_function_privilege('anon', 'public.record_payment(uuid,int4,text,text,timestamptz,text,uuid,boolean)', 'execute') as ok
union all select 'confirm_payment: authenticated oui, anon non',
       has_function_privilege('authenticated', 'public.confirm_payment(uuid,boolean)', 'execute') and not has_function_privilege('anon', 'public.confirm_payment(uuid,boolean)', 'execute')
union all select 'set_payment_status: authenticated oui, anon non',
       has_function_privilege('authenticated', 'public.set_payment_status(uuid,text,text)', 'execute') and not has_function_privilege('anon', 'public.set_payment_status(uuid,text,text)', 'execute')
union all select 'payments_summary: authenticated oui, anon non',
       has_function_privilege('authenticated', 'public.payments_summary(timestamptz,timestamptz)', 'execute') and not has_function_privilege('anon', 'public.payments_summary(timestamptz,timestamptz)', 'execute')
union all select 'fonctions internes inaccessibles aux rôles API',
       not has_function_privilege('authenticated', 'public.payment_summary(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.payment_recalc_order(uuid)', 'execute')
union all select 'fonctions SECURITY DEFINER avec search_path fixé',
       (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_payment','confirm_payment','set_payment_status','payments_summary','payment_summary','payment_recalc_order') and prosecdef and proconfig::text like '%search_path%') = 6
union all select 'aucun droit d''écriture directe sur les paiements',
       not has_table_privilege('authenticated', 'public.order_payments', 'insert') and not has_table_privilege('authenticated', 'public.order_payments', 'update') and not has_table_privilege('authenticated', 'public.order_payments', 'delete')
union all select 'historique en lecture seule',
       not has_table_privilege('authenticated', 'public.order_payment_events', 'insert') and not has_table_privilege('authenticated', 'public.order_payment_events', 'update') and not has_table_privilege('authenticated', 'public.order_payment_events', 'delete')
union all select 'anon sans aucun accès',
       not has_table_privilege('anon', 'public.order_payments', 'select') and not has_table_privilege('anon', 'public.v_order_payments', 'select') and not has_table_privilege('anon', 'public.payment_methods', 'select')
union all select 'RLS actif sur les 3 tables',
       (select bool_and(relrowsecurity) from pg_class where relnamespace='public'::regnamespace and relname in ('payment_methods','order_payments','order_payment_events'))
union all select '4 moyens de paiement de départ',
       (select count(*) from public.payment_methods) = 4
union all select 'aucun paiement (rien d''inventé)',
       (select count(*) from public.order_payments) = 0;


-- =====================================================================
-- PARTIE 3 — SCÉNARIOS DE TEST (tout est ANNULÉ automatiquement)
-- Le bloc se termine volontairement par l'erreur « RESULTATS DES TESTS » : PostgreSQL annule alors toute la transaction
-- (commandes, paiements, stock et tarif de test compris). Le rapport est dans le message d'erreur : chaque ligne doit finir par OK.
-- Seule trace durable : les séquences de références (commandes et reçus) avancent de quelques numéros.
-- Prérequis : un produit publié dans une catégorie active, 1 administrateur.
-- =====================================================================
do $$
declare
  v_admin   uuid := (select user_id from public.admin_users limit 1);
  v_pid     uuid := (select id from public.products where is_published limit 1);
  v_items   jsonb;
  v_ord1    jsonb; v_ord2 jsonb; v_ord3 jsonb;
  v_o1 uuid; v_o2 uuid; v_o3 uuid;
  v_t1 int; v_t2 int;
  v_a int; v_b int;
  r1 jsonb; r2 jsonb; r3 jsonb; rm jsonb;
  v_key uuid := gen_random_uuid();
  v_status text; v_cnt int; v_stock0 int; v_stock1 int; v_sum int;
  v_report text := '';
  v_summary jsonb;
begin
  insert into public.delivery_fees (commune, fee_fcfa) values ('Zone Test', 1000) on conflict (commune) do nothing;
  insert into public.product_inventory (product_id, stock_quantity) values (v_pid, 50) on conflict (product_id) do update set stock_quantity = 50;
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 2));
  set local role anon;
  v_ord1 := public.create_order(gen_random_uuid(), 'Client Test', 'test@example.com', '0700000201', 'delivery', 'Zone Test', '12 rue des tests', null, v_items, '');
  v_ord2 := public.create_order(gen_random_uuid(), 'Client Test', 'test@example.com', '0700000202', 'pickup', null, null, null, v_items, '');
  v_ord3 := public.create_order(gen_random_uuid(), 'Client Test', 'test@example.com', '0700000203', 'pickup', null, null, null, v_items, '');
  reset role;
  select id, total_fcfa into v_o1, v_t1 from public.orders where reference = v_ord1->>'reference';
  select id, total_fcfa into v_o2, v_t2 from public.orders where reference = v_ord2->>'reference';
  select id into v_o3 from public.orders where reference = v_ord3->>'reference';
  select stock_quantity into v_stock0 from public.product_inventory where product_id = v_pid;
  v_a := v_t1 / 4; v_b := v_t1 - v_a;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'agent@test.example')::text, true);
  set local role authenticated;

  -- 1. Paiement partiel en espèces confirmé à la saisie : solde = total - acompte, commande pas encore « paid »
  r1 := public.record_payment(v_o1, v_a, 'cash', null, now(), 'acompte', gen_random_uuid(), true);
  v_report := v_report || format(E'1 acompte espèces: statut=%s solde=%s reçu=%s commande=%s -> %s\n', r1->>'status', r1->>'balance_fcfa', r1->>'receipt_number', r1->>'order_payment_status',
    case when r1->>'status' = 'confirmed' and (r1->>'balance_fcfa')::int = v_t1 - v_a and r1->>'receipt_number' ~ '^RC-\d{4}-\d{6}$' and r1->>'order_payment_status' = 'pending' then 'OK' else 'ECHEC' end);

  -- 2. Règlement du solde : plusieurs paiements, commande « paid », solde 0
  r2 := public.record_payment(v_o1, v_b, 'cash', null, now(), 'solde', gen_random_uuid(), true);
  v_report := v_report || format(E'2 solde réglé: solde=%s commande=%s -> %s\n', r2->>'balance_fcfa', r2->>'order_payment_status',
    case when (r2->>'balance_fcfa')::int = 0 and r2->>'order_payment_status' = 'paid' and r2->>'receipt_number' <> r1->>'receipt_number' then 'OK' else 'ECHEC' end);

  -- 3. Montants invalides et surpaiement refusés
  begin perform public.record_payment(v_o1, 0, 'cash', null, now(), null, gen_random_uuid(), true); v_report := v_report || E'3a montant 0: ECHEC\n';
  exception when others then v_report := v_report || format(E'3a montant 0: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_AMOUNT' then 'OK' else 'ECHEC' end); end;
  begin perform public.record_payment(v_o1, -500, 'cash', null, now(), null, gen_random_uuid(), true); v_report := v_report || E'3b montant négatif: ECHEC\n';
  exception when others then v_report := v_report || format(E'3b montant négatif: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_AMOUNT' then 'OK' else 'ECHEC' end); end;
  begin perform public.record_payment(v_o1, 1, 'cash', null, now(), null, gen_random_uuid(), true); v_report := v_report || E'3c surpaiement: ECHEC\n';
  exception when others then v_report := v_report || format(E'3c surpaiement (commande soldée): %s -> %s\n', sqlerrm, case when sqlerrm = 'AMOUNT_EXCEEDS_BALANCE' then 'OK' else 'ECHEC' end); end;
  begin perform public.record_payment(v_o2, 100, 'cash', null, now() + interval '3 days', null, gen_random_uuid(), true); v_report := v_report || E'3d date future: ECHEC\n';
  exception when others then v_report := v_report || format(E'3d date future: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_DATE' then 'OK' else 'ECHEC' end); end;

  -- 4. Mobile Money : jamais confirmé à la saisie, référence obligatoire et unique, confirmation par attestation, double confirmation refusée
  begin perform public.record_payment(v_o2, 100, 'mobile_money', 'MM-TEST-0001', now(), null, gen_random_uuid(), true); v_report := v_report || E'4a confirmation à la saisie: ECHEC\n';
  exception when others then v_report := v_report || format(E'4a Mobile Money confirmé à la saisie: %s -> %s\n', sqlerrm, case when sqlerrm = 'VERIFICATION_REQUIRED' then 'OK' else 'ECHEC' end); end;
  begin perform public.record_payment(v_o2, 100, 'mobile_money', null, now(), null, gen_random_uuid(), false); v_report := v_report || E'4b sans référence: ECHEC\n';
  exception when others then v_report := v_report || format(E'4b Mobile Money sans référence: %s -> %s\n', sqlerrm, case when sqlerrm = 'REFERENCE_REQUIRED' then 'OK' else 'ECHEC' end); end;
  rm := public.record_payment(v_o2, v_t2 / 2, 'mobile_money', 'MM-TEST-0001', now(), null, v_key, false);
  v_report := v_report || format(E'4c Mobile Money saisi: statut=%s reçu=%s commande=%s -> %s\n', rm->>'status', coalesce(rm->>'receipt_number', 'aucun'), rm->>'order_payment_status',
    case when rm->>'status' = 'pending_confirmation' and rm->>'receipt_number' is null and (rm->>'confirmed_total_fcfa')::int = 0 then 'OK' else 'ECHEC' end);
  r3 := public.record_payment(v_o2, v_t2 / 2, 'mobile_money', 'MM-TEST-0001', now(), null, v_key, false);
  select count(*) into v_cnt from public.order_payments where idempotency_key = v_key;
  v_report := v_report || format(E'4d rejeu de la même saisie: même paiement=%s lignes=%s -> %s\n', (r3->>'id') = (rm->>'id'), v_cnt, case when (r3->>'id') = (rm->>'id') and v_cnt = 1 and r3->>'idempotent_replay' = 'true' then 'OK' else 'ECHEC' end);
  begin perform public.record_payment(v_o2, 100, 'mobile_money', ' mm-test-0001 ', now(), null, gen_random_uuid(), false); v_report := v_report || E'4e référence en double: ECHEC\n';
  exception when others then v_report := v_report || format(E'4e même transaction saisie deux fois: %s -> %s\n', sqlerrm, case when sqlerrm = 'DUPLICATE_REFERENCE' then 'OK' else 'ECHEC' end); end;
  begin perform public.confirm_payment((rm->>'id')::uuid, false); v_report := v_report || E'4f sans attestation: ECHEC\n';
  exception when others then v_report := v_report || format(E'4f confirmation sans attestation: %s -> %s\n', sqlerrm, case when sqlerrm = 'ATTESTATION_REQUIRED' then 'OK' else 'ECHEC' end); end;
  r3 := public.confirm_payment((rm->>'id')::uuid, true);
  v_report := v_report || format(E'4g confirmation attestée: statut=%s reçu=%s solde=%s -> %s\n', r3->>'status', r3->>'receipt_number', r3->>'balance_fcfa',
    case when r3->>'status' = 'confirmed' and r3->>'receipt_number' ~ '^RC-\d{4}-\d{6}$' and (r3->>'balance_fcfa')::int = v_t2 - v_t2 / 2 then 'OK' else 'ECHEC' end);
  begin perform public.confirm_payment((rm->>'id')::uuid, true); v_report := v_report || E'4h double confirmation: ECHEC\n';
  exception when others then v_report := v_report || format(E'4h double confirmation: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_TRANSITION' then 'OK' else 'ECHEC' end); end;

  -- 5. Refus et annulation d'un paiement en attente ; libération de la référence
  r1 := public.record_payment(v_o2, 100, 'mobile_money', 'MM-TEST-0002', now(), null, gen_random_uuid(), false);
  r2 := public.set_payment_status((r1->>'id')::uuid, 'rejected', 'Transaction introuvable');
  v_report := v_report || format(E'5a refus d''un paiement en attente: statut=%s -> %s\n', r2->>'status', case when r2->>'status' = 'rejected' then 'OK' else 'ECHEC' end);
  r1 := public.record_payment(v_o2, 100, 'mobile_money', 'MM-TEST-0002', now(), null, gen_random_uuid(), false);
  v_report := v_report || format(E'5b référence libérée après refus (nouvelle saisie possible): statut=%s -> %s\n', r1->>'status', case when r1->>'status' = 'pending_confirmation' then 'OK' else 'ECHEC' end);
  r2 := public.set_payment_status((r1->>'id')::uuid, 'cancelled', 'Saisie par erreur');
  begin perform public.set_payment_status((r1->>'id')::uuid, 'confirmed', 'x'); v_report := v_report || E'5c transition libre: ECHEC\n';
  exception when others then v_report := v_report || format(E'5c transition non autorisée: %s -> %s\n', sqlerrm, case when sqlerrm = 'INVALID_TRANSITION' then 'OK' else 'ECHEC' end); end;

  -- 6. Contrepassation d'un paiement confirmé : motif obligatoire, historique et reçu conservés, commande repasse sous « paid »
  begin perform public.set_payment_status((r3->>'id')::uuid, 'reversed', ''); v_report := v_report || E'6a sans motif: ECHEC\n';
  exception when others then v_report := v_report || format(E'6a contrepassation sans motif: %s -> %s\n', sqlerrm, case when sqlerrm = 'REASON_REQUIRED' then 'OK' else 'ECHEC' end); end;
  r2 := public.record_payment(v_o2, v_t2 - v_t2 / 2, 'cash', null, now(), 'solde', gen_random_uuid(), true);
  select payment_status into v_status from public.orders where id = v_o2;
  v_report := v_report || format(E'6b commande 2 soldée: payment_status=%s -> %s\n', v_status, case when v_status = 'paid' then 'OK' else 'ECHEC' end);
  r2 := public.set_payment_status((r3->>'id')::uuid, 'reversed', 'Erreur de rapprochement bancaire');
  select payment_status into v_status from public.orders where id = v_o2;
  select count(*) into v_cnt from public.order_payment_events where payment_id = (r3->>'id')::uuid;
  v_report := v_report || format(E'6c contrepassation: statut=%s reçu conservé=%s événements=%s commande=%s -> %s\n', r2->>'status', r2->>'receipt_number' is not null, v_cnt, v_status,
    case when r2->>'status' = 'reversed' and r2->>'receipt_number' is not null and v_cnt = 3 and v_status = 'pending' then 'OK' else 'ECHEC' end);

  -- 7. Aucune suppression ni modification possibles, même par le propriétaire
  begin delete from public.order_payments where id = (r3->>'id')::uuid; v_report := v_report || E'7a suppression directe: ECHEC\n';
  exception when others then v_report := v_report || E'7a suppression directe par un client API refusée -> OK\n'; end;
  reset role;
  begin delete from public.order_payments where id = (r3->>'id')::uuid; v_report := v_report || E'7b suppression par le propriétaire: ECHEC\n';
  exception when others then v_report := v_report || format(E'7b suppression par le propriétaire: %s -> %s\n', sqlerrm, case when sqlerrm = 'PAYMENT_DELETE_FORBIDDEN' then 'OK' else 'ECHEC' end); end;
  begin update public.order_payments set amount_fcfa = 1 where id = (r3->>'id')::uuid; v_report := v_report || E'7c modification du montant: ECHEC\n';
  exception when others then v_report := v_report || format(E'7c modification du montant: %s -> %s\n', sqlerrm, case when sqlerrm = 'PAYMENT_IMMUTABLE' then 'OK' else 'ECHEC' end); end;
  begin update public.order_payment_events set reason = 'x'; v_report := v_report || E'7d modification de l''historique: ECHEC\n';
  exception when others then v_report := v_report || format(E'7d modification de l''historique: %s -> %s\n', sqlerrm, case when sqlerrm = 'PAYMENT_HISTORY_IMMUTABLE' then 'OK' else 'ECHEC' end); end;

  -- 8. Le stock n'est jamais touché par les paiements
  select stock_quantity into v_stock1 from public.product_inventory where product_id = v_pid;
  v_report := v_report || format(E'8 stock avant=%s après=%s -> %s\n', v_stock0, v_stock1, case when v_stock0 = v_stock1 then 'OK' else 'ECHEC' end);

  -- 9. Permissions : non-administrateur et visiteur refusés ; commande annulée refusée
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'intrus@test.example')::text, true);
  set local role authenticated;
  begin perform public.record_payment(v_o3, 100, 'cash', null, now(), null, gen_random_uuid(), true); v_report := v_report || E'9a non-admin: ECHEC\n';
  exception when others then v_report := v_report || format(E'9a non-administrateur: %s -> %s\n', sqlerrm, case when sqlerrm = 'FORBIDDEN' then 'OK' else 'ECHEC' end); end;
  begin perform public.payments_summary(now() - interval '1 day', now() + interval '1 day'); v_report := v_report || E'9b résumé non-admin: ECHEC\n';
  exception when others then v_report := v_report || format(E'9b rapport non-administrateur: %s -> %s\n', sqlerrm, case when sqlerrm = 'FORBIDDEN' then 'OK' else 'ECHEC' end); end;
  begin perform 1 from public.order_payments limit 1;
    get diagnostics v_cnt = row_count;
    v_report := v_report || format(E'9c lecture des paiements par un non-admin: %s ligne(s) -> %s\n', v_cnt, case when v_cnt = 0 then 'OK' else 'ECHEC' end);
  exception when others then v_report := v_report || E'9c lecture des paiements par un non-admin refusée -> OK\n'; end;
  reset role;
  set local role anon;
  begin perform public.record_payment(v_o3, 100, 'cash', null, now(), null, gen_random_uuid(), true); v_report := v_report || E'9d visiteur: ECHEC\n';
  exception when others then v_report := v_report || E'9d visiteur anonyme : exécution refusée -> OK\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'agent@test.example')::text, true);
  set local role authenticated;
  perform public.admin_set_order_status(v_o3, 'cancelled');
  begin perform public.record_payment(v_o3, 100, 'cash', null, now(), null, gen_random_uuid(), true); v_report := v_report || E'9e commande annulée: ECHEC\n';
  exception when others then v_report := v_report || format(E'9e paiement sur commande annulée: %s -> %s\n', sqlerrm, case when sqlerrm = 'ORDER_CANCELLED' then 'OK' else 'ECHEC' end); end;

  -- 10. Cohérence du rapport avec les lignes
  v_summary := public.payments_summary(now() - interval '1 day', now() + interval '1 day');
  select coalesce(sum(amount_fcfa), 0) into v_sum from public.order_payments where status = 'confirmed';
  reset role;
  select coalesce(sum(amount_fcfa), 0) into v_sum from public.order_payments where status = 'confirmed';
  v_report := v_report || format(E'10 rapport: encaissé=%s (lignes confirmées=%s) en attente=%s incohérences=%s -> %s\n', v_summary->>'confirmed_total_fcfa', v_sum, v_summary->>'pending_count', v_summary->>'inconsistent_orders_count',
    case when (v_summary->>'confirmed_total_fcfa')::int = v_sum and (v_summary->>'inconsistent_orders_count')::int = 0 then 'OK' else 'ECHEC' end);

  raise exception E'RESULTATS DES TESTS (tout est annule)\n%', v_report;
end $$;


-- =====================================================================
-- PARTIE 4 — RETOUR ARRIÈRE (à n'utiliser que si la migration doit être défaite)
-- LIMITES : supprime TOUS les paiements et leur historique (tables supprimées) ; orders.payment_status n'est pas recalculé
-- (une commande passée à « paid » par ce module resterait « paid ») : à corriger manuellement avant de supprimer si nécessaire.
-- =====================================================================
-- begin;
--   drop function if exists public.payments_summary(timestamptz, timestamptz);
--   drop function if exists public.set_payment_status(uuid, text, text);
--   drop function if exists public.confirm_payment(uuid, boolean);
--   drop function if exists public.record_payment(uuid, int4, text, text, timestamptz, text, uuid, boolean);
--   drop function if exists public.payment_recalc_order(uuid);
--   drop function if exists public.payment_summary(uuid);
--   drop view if exists public.v_order_payments;
--   drop table if exists public.order_payment_events;
--   drop table if exists public.order_payments;
--   drop table if exists public.payment_methods;
--   drop function if exists public.payments_guard();
--   drop sequence if exists public.payment_receipt_seq;
-- commit;
