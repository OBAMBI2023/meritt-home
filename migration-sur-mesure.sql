-- =====================================================================
-- MERITT HOME — Module « Création sur mesure » : migration additive (PRÉPARÉE, NON APPLIQUÉE)
--
-- STATUT : préparée sur la branche feat/creation-sur-mesure. Ne PAS l'exécuter en production sans validation.
-- À appliquer d'abord sur le projet Supabase de TEST (voir test-env/LISEZ-MOI.md), puis en production.
-- Cette migration n'est pas idempotente (« create table » échouerait au second passage) : ne pas la rejouer.
--
-- Ne touche à AUCUNE table ni fonction existante (orders, order_items, create_order, paiements, factures) :
-- elle ajoute des objets nouveaux, plus une fonction de conversion qui ÉCRIT dans orders / order_items
-- uniquement quand un administrateur la déclenche explicitement (jamais automatiquement).
--
-- Contenu :
--   PARTIE 0 — Contrôles préalables (lecture seule)
--   PARTIE 1 — Migration (une transaction)
--   PARTIE 2 — Vérifications après application (lecture seule)
--   PARTIE 3 — Scénarios de test (écrivent puis ANNULENT) — projet de TEST uniquement
--   PARTIE 4 — Retour arrière
-- Exécutez chaque partie séparément dans l'éditeur SQL.
--
-- Modèle de sécurité (identique à create_order) :
--   * Le navigateur n'écrit jamais directement dans les tables : seule la fonction create_custom_request()
--     (SECURITY DEFINER, search_path vide) crée une demande, et elle revalide TOUT côté base.
--   * Aucun accès anonyme en lecture : ni aux tables, ni aux images (bucket privé).
--   * Les administrateurs (is_admin()) lisent les tables et les images (URL signées) ; leurs écritures passent
--     par des fonctions qui journalisent chaque changement.
-- =====================================================================


-- =====================================================================
-- PARTIE 0 — CONTRÔLES PRÉALABLES (lecture seule)
-- Résultat attendu : toutes les lignes "ok" = true.
-- =====================================================================
select 'is_admin() existe'          as controle, exists (select 1 from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace) as ok
union all select 'set_updated_at() existe',      exists (select 1 from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace)
union all select 'orders.fulfillment_method',    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'fulfillment_method')
union all select 'tables sur mesure absentes',   not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name like 'custom_request%')
union all select 'bucket sur mesure absent',     not exists (select 1 from storage.buckets where id = 'meritt-custom-requests');


-- =====================================================================
-- PARTIE 1 — MIGRATION
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1.1 Demandes
-- ---------------------------------------------------------------------
create sequence public.custom_request_seq;

create table public.custom_requests (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique
                           default ('SM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.custom_request_seq')::text, 5, '0')),
  idempotency_key        uuid not null unique,
  status                 text not null default 'new'
                           constraint custom_requests_status_check check (status in
                             ('new', 'in_review', 'info_needed', 'quote_preparing', 'quote_sent', 'accepted', 'refused', 'completed')),
  -- Client
  customer_name          text not null constraint custom_requests_name_check check (char_length(customer_name) between 2 and 120),
  customer_phone         text not null,
  customer_phone_digits  text not null constraint custom_requests_phone_check check (customer_phone_digits ~ '^\d{8,15}$'),
  customer_email         text constraint custom_requests_email_check check (customer_email is null or (char_length(customer_email) <= 160 and customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  commune                text constraint custom_requests_commune_check check (commune is null or char_length(commune) <= 80),
  preferred_contact      text not null default 'whatsapp'
                           constraint custom_requests_contact_check check (preferred_contact in ('whatsapp', 'phone', 'email')),
  -- Projet
  project_type           text not null
                           constraint custom_requests_type_check check (project_type in
                             ('living', 'bedroom', 'dressing', 'kitchen', 'tv_unit', 'dining', 'decoration', 'professional', 'other')),
  inspiration_source     text constraint custom_requests_source_check check (inspiration_source is null or inspiration_source in
                             ('pinterest', 'instagram', 'tiktok', 'facebook', 'catalogue', 'other')),
  reference_url          text constraint custom_requests_url_check check (reference_url is null or (char_length(reference_url) <= 500 and reference_url ~ '^https://[^\s]+$')),
  description            text not null constraint custom_requests_description_check check (char_length(description) between 10 and 4000),
  width_cm               int4 constraint custom_requests_width_check check (width_cm is null or width_cm between 1 and 10000),
  height_cm              int4 constraint custom_requests_height_check check (height_cm is null or height_cm between 1 and 10000),
  depth_cm               int4 constraint custom_requests_depth_check check (depth_cm is null or depth_cm between 1 and 10000),
  materials              text constraint custom_requests_materials_check check (materials is null or char_length(materials) <= 300),
  colors                 text constraint custom_requests_colors_check check (colors is null or char_length(colors) <= 300),
  finishes               text constraint custom_requests_finishes_check check (finishes is null or char_length(finishes) <= 300),
  quantity               int4 not null default 1 constraint custom_requests_quantity_check check (quantity between 1 and 100),
  constraints_text       text constraint custom_requests_constraints_check check (constraints_text is null or char_length(constraints_text) <= 1000),
  -- Budget et délai
  budget_range           text not null default 'to_define'
                           constraint custom_requests_budget_check check (budget_range in
                             ('lt_100k', '100k_250k', '250k_500k', '500k_1m', 'gt_1m', 'to_define')),
  deadline_kind          text not null default 'none'
                           constraint custom_requests_deadline_check check (deadline_kind in ('asap', 'month', 'two_three_months', 'custom_date', 'none')),
  deadline_date          date,
  -- Consentement
  consent_at             timestamptz not null default now(),
  -- Suivi interne
  assigned_to            text constraint custom_requests_assigned_check check (assigned_to is null or char_length(assigned_to) <= 80),
  quote_amount_fcfa      int4 constraint custom_requests_quote_check check (quote_amount_fcfa is null or quote_amount_fcfa between 0 and 2000000000),
  converted_order_id     uuid unique references public.orders (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint custom_requests_deadline_date_check check ((deadline_kind = 'custom_date') = (deadline_date is not null))
);

create index custom_requests_status_created_idx on public.custom_requests (status, created_at desc);
create index custom_requests_created_idx        on public.custom_requests (created_at desc);
create index custom_requests_phone_idx          on public.custom_requests (customer_phone_digits, created_at desc);

create trigger custom_requests_set_updated_at before update on public.custom_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 1.2 Images jointes (le fichier est dans le bucket privé ; ici seulement la référence)
-- ---------------------------------------------------------------------
create table public.custom_request_images (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.custom_requests (id) on delete cascade,
  kind          text not null constraint custom_request_images_kind_check check (kind in ('inspiration', 'space')),
  storage_path  text not null unique,
  mime_type     text not null constraint custom_request_images_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    int4 not null constraint custom_request_images_size_check check (size_bytes between 1 and 5242880),
  created_at    timestamptz not null default now()
);
create index custom_request_images_request_idx on public.custom_request_images (request_id);

-- ---------------------------------------------------------------------
-- 1.3 Notes internes et échanges avec le client
-- ---------------------------------------------------------------------
create table public.custom_request_notes (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.custom_requests (id) on delete cascade,
  kind          text not null constraint custom_request_notes_kind_check check (kind in ('note', 'exchange')),
  body          text not null constraint custom_request_notes_body_check check (char_length(body) between 1 and 2000),
  author_id     uuid,
  author_email  text,
  created_at    timestamptz not null default now()
);
create index custom_request_notes_request_idx on public.custom_request_notes (request_id, created_at desc);

-- ---------------------------------------------------------------------
-- 1.4 Journal des événements (création, changement de statut, responsable, devis, conversion)
-- ---------------------------------------------------------------------
create table public.custom_request_events (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.custom_requests (id) on delete cascade,
  event         text not null constraint custom_request_events_event_check check (event in ('created', 'status_changed', 'assigned', 'quote_set', 'converted')),
  from_value    text,
  to_value      text,
  actor_id      uuid,
  actor_email   text,
  created_at    timestamptz not null default now()
);
create index custom_request_events_request_idx on public.custom_request_events (request_id, created_at desc);

-- ---------------------------------------------------------------------
-- 1.5 RLS : lecture réservée aux administrateurs, aucune écriture directe, aucun accès anonyme
-- ---------------------------------------------------------------------
revoke all on public.custom_requests, public.custom_request_images, public.custom_request_notes, public.custom_request_events from anon, authenticated;
revoke all on sequence public.custom_request_seq from anon, authenticated;

alter table public.custom_requests        enable row level security;
alter table public.custom_request_images  enable row level security;
alter table public.custom_request_notes   enable row level security;
alter table public.custom_request_events  enable row level security;

create policy "Admins read custom requests"       on public.custom_requests       for select to authenticated using ((select public.is_admin()));
create policy "Admins read custom request images" on public.custom_request_images for select to authenticated using ((select public.is_admin()));
create policy "Admins read custom request notes"  on public.custom_request_notes  for select to authenticated using ((select public.is_admin()));
create policy "Admins read custom request events" on public.custom_request_events for select to authenticated using ((select public.is_admin()));

grant select on public.custom_requests, public.custom_request_images, public.custom_request_notes, public.custom_request_events to authenticated;

-- ---------------------------------------------------------------------
-- 1.6 Stockage privé des pièces jointes
--     * bucket PRIVÉ, 5 Mo par fichier, JPEG / PNG / WebP uniquement (appliqué par le stockage lui-même)
--     * anon et authenticated peuvent ENVOYER, uniquement sous « <clé-de-la-demande>/<uuid>.<ext> »
--     * seuls les administrateurs peuvent LIRE (URL signées) et SUPPRIMER ; personne n'a de droit UPDATE
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meritt-custom-requests', 'meritt-custom-requests', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy "Custom requests: upload under request folder" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'meritt-custom-requests'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  );

create policy "Custom requests: admins read files" on storage.objects
  for select to authenticated
  using (bucket_id = 'meritt-custom-requests' and (select public.is_admin()));

create policy "Custom requests: admins delete files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'meritt-custom-requests' and (select public.is_admin()));

-- ---------------------------------------------------------------------
-- 1.7 Création d'une demande (publique) — TOUTE la validation est ici, jamais lue depuis le navigateur.
--     Erreurs (message de l'exception, lu par lib/custom-requests.ts) :
--       REQUEST_REJECTED, INVALID_REQUEST, CONSENT_REQUIRED, INVALID_CUSTOMER, INVALID_PHONE, INVALID_EMAIL,
--       INVALID_PROJECT, INVALID_URL, INVALID_DIMENSIONS, INVALID_DEADLINE, INVALID_IMAGES, RATE_LIMITED
--     Quotas par téléphone : 3 demandes par heure, 8 par jour (modifiables ci-dessous).
-- ---------------------------------------------------------------------
create function public.create_custom_request(
  p_idempotency_key   uuid,
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_email    text,
  p_commune           text,
  p_preferred_contact text,
  p_project_type      text,
  p_inspiration_source text,
  p_reference_url     text,
  p_description       text,
  p_width_cm          int4,
  p_height_cm         int4,
  p_depth_cm          int4,
  p_materials         text,
  p_colors            text,
  p_finishes          text,
  p_quantity          int4,
  p_constraints       text,
  p_budget_range      text,
  p_deadline_kind     text,
  p_deadline_date     date,
  p_consent           boolean,
  p_images            jsonb,
  p_website           text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_per_hour constant int := 3;
  c_max_per_day  constant int := 8;
  c_max_images   constant int := 8;
  v_existing   record;
  v_id         uuid;
  v_ref        text;
  v_name       text := btrim(coalesce(p_customer_name, ''));
  v_phone      text := btrim(coalesce(p_customer_phone, ''));
  v_digits     text := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  v_email      text := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
  v_commune    text := nullif(btrim(coalesce(p_commune, '')), '');
  v_url        text := nullif(btrim(coalesce(p_reference_url, '')), '');
  v_desc       text := btrim(coalesce(p_description, ''));
  v_materials  text := nullif(btrim(coalesce(p_materials, '')), '');
  v_colors     text := nullif(btrim(coalesce(p_colors, '')), '');
  v_finishes   text := nullif(btrim(coalesce(p_finishes, '')), '');
  v_constr     text := nullif(btrim(coalesce(p_constraints, '')), '');
  v_img        jsonb;
  v_path       text;
  v_kind       text;
  v_obj        record;
  v_size       bigint;
  v_mime       text;
  v_count      int;
begin
  -- Honeypot : un champ caché rempli = robot. Refus explicite.
  if btrim(coalesce(p_website, '')) <> '' then
    raise exception 'REQUEST_REJECTED';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_REQUEST';
  end if;

  -- Idempotence : deux appels simultanés avec la même clé sont sérialisés (protection contre le double envoi).
  perform pg_advisory_xact_lock(hashtextextended('mh-custom-request-key:' || p_idempotency_key::text, 0));
  select r.id, r.reference into v_existing from public.custom_requests r where r.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'reference', v_existing.reference, 'idempotent_replay', true);
  end if;

  if coalesce(p_consent, false) is not true then raise exception 'CONSENT_REQUIRED'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'INVALID_CUSTOMER'; end if;
  if v_digits !~ '^\d{8,15}$' or char_length(v_phone) > 30 then raise exception 'INVALID_PHONE'; end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'INVALID_EMAIL'; end if;
  if v_commune is not null and char_length(v_commune) > 80 then raise exception 'INVALID_CUSTOMER'; end if;
  if p_preferred_contact is null or p_preferred_contact not in ('whatsapp', 'phone', 'email') then raise exception 'INVALID_REQUEST'; end if;
  if p_preferred_contact = 'email' and v_email is null then raise exception 'INVALID_EMAIL'; end if;

  if p_project_type is null or p_project_type not in ('living', 'bedroom', 'dressing', 'kitchen', 'tv_unit', 'dining', 'decoration', 'professional', 'other') then
    raise exception 'INVALID_PROJECT';
  end if;
  if char_length(v_desc) < 10 or char_length(v_desc) > 4000 then raise exception 'INVALID_PROJECT'; end if;
  if p_inspiration_source is not null and p_inspiration_source not in ('pinterest', 'instagram', 'tiktok', 'facebook', 'catalogue', 'other') then
    raise exception 'INVALID_PROJECT';
  end if;
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^\s]+$') then raise exception 'INVALID_URL'; end if;
  if (p_width_cm is not null and p_width_cm not between 1 and 10000)
     or (p_height_cm is not null and p_height_cm not between 1 and 10000)
     or (p_depth_cm is not null and p_depth_cm not between 1 and 10000)
     or coalesce(p_quantity, 1) not between 1 and 100 then
    raise exception 'INVALID_DIMENSIONS';
  end if;
  if char_length(coalesce(v_materials, '')) > 300 or char_length(coalesce(v_colors, '')) > 300
     or char_length(coalesce(v_finishes, '')) > 300 or char_length(coalesce(v_constr, '')) > 1000 then
    raise exception 'INVALID_PROJECT';
  end if;
  if p_budget_range is null or p_budget_range not in ('lt_100k', '100k_250k', '250k_500k', '500k_1m', 'gt_1m', 'to_define') then
    raise exception 'INVALID_REQUEST';
  end if;
  if p_deadline_kind is null or p_deadline_kind not in ('asap', 'month', 'two_three_months', 'custom_date', 'none') then
    raise exception 'INVALID_DEADLINE';
  end if;
  if p_deadline_kind = 'custom_date' then
    if p_deadline_date is null or p_deadline_date < current_date or p_deadline_date > current_date + 1825 then
      raise exception 'INVALID_DEADLINE';
    end if;
  elsif p_deadline_date is not null then
    raise exception 'INVALID_DEADLINE';
  end if;

  -- Images : au plus 8, chemin sous « <clé>/ », fichier réellement présent dans le bucket privé, taille et type contrôlés.
  if p_images is null or jsonb_typeof(p_images) <> 'array' then raise exception 'INVALID_IMAGES'; end if;
  v_count := jsonb_array_length(p_images);
  if v_count > c_max_images then raise exception 'INVALID_IMAGES'; end if;
  if (select count(distinct e->>'path') from jsonb_array_elements(p_images) e) <> v_count then raise exception 'INVALID_IMAGES'; end if;

  -- Quota par téléphone (verrou par numéro : pas de contournement par requêtes simultanées).
  perform pg_advisory_xact_lock(hashtextextended('mh-custom-request-phone:' || v_digits, 0));
  if (select count(*) from public.custom_requests r where r.customer_phone_digits = v_digits and r.created_at > now() - interval '1 hour') >= c_max_per_hour
     or (select count(*) from public.custom_requests r where r.customer_phone_digits = v_digits and r.created_at > now() - interval '1 day') >= c_max_per_day then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.custom_requests (
    idempotency_key, customer_name, customer_phone, customer_phone_digits, customer_email, commune, preferred_contact,
    project_type, inspiration_source, reference_url, description, width_cm, height_cm, depth_cm,
    materials, colors, finishes, quantity, constraints_text, budget_range, deadline_kind, deadline_date)
  values (
    p_idempotency_key, v_name, v_phone, v_digits, v_email, v_commune, p_preferred_contact,
    p_project_type, p_inspiration_source, v_url, v_desc, p_width_cm, p_height_cm, p_depth_cm,
    v_materials, v_colors, v_finishes, coalesce(p_quantity, 1), v_constr, p_budget_range, p_deadline_kind, p_deadline_date)
  returning id, reference into v_id, v_ref;

  for v_img in select e from jsonb_array_elements(p_images) e loop
    v_path := v_img->>'path';
    v_kind := v_img->>'kind';
    if v_kind is null or v_kind not in ('inspiration', 'space') then raise exception 'INVALID_IMAGES'; end if;
    if v_path is null or v_path !~ ('^' || p_idempotency_key::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
      raise exception 'INVALID_IMAGES';
    end if;
    select o.metadata into v_obj from storage.objects o where o.bucket_id = 'meritt-custom-requests' and o.name = v_path;
    if not found then raise exception 'INVALID_IMAGES'; end if;
    v_size := coalesce((v_obj.metadata->>'size')::bigint, 0);
    v_mime := v_obj.metadata->>'mimetype';
    if v_size < 1 or v_size > 5242880 or v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'INVALID_IMAGES';
    end if;
    insert into public.custom_request_images (request_id, kind, storage_path, mime_type, size_bytes)
    values (v_id, v_kind, v_path, v_mime, v_size::int4);
  end loop;

  insert into public.custom_request_events (request_id, event, to_value) values (v_id, 'created', 'new');

  return jsonb_build_object('id', v_id, 'reference', v_ref, 'idempotent_replay', false);
end;
$$;

revoke all on function public.create_custom_request(uuid, text, text, text, text, text, text, text, text, text, int4, int4, int4, text, text, text, int4, text, text, text, date, boolean, jsonb, text) from public;
grant execute on function public.create_custom_request(uuid, text, text, text, text, text, text, text, text, text, int4, int4, int4, text, text, text, int4, text, text, text, date, boolean, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1.8 Suivi par l'administrateur : statut, responsable et devis (journalisés)
-- ---------------------------------------------------------------------
create function public.admin_update_custom_request(
  p_request_id uuid,
  p_status     text,
  p_assigned_to text,
  p_quote_amount_fcfa int4
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.custom_requests%rowtype;
  v_actor text := (select auth.jwt() ->> 'email');
  v_assignee text := nullif(btrim(coalesce(p_assigned_to, '')), '');
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'NOT_ADMIN'; end if;
  if p_status is null or p_status not in ('new', 'in_review', 'info_needed', 'quote_preparing', 'quote_sent', 'accepted', 'refused', 'completed') then
    raise exception 'INVALID_STATUS';
  end if;
  if char_length(coalesce(v_assignee, '')) > 80 then raise exception 'INVALID_ASSIGNEE'; end if;
  if p_quote_amount_fcfa is not null and p_quote_amount_fcfa not between 0 and 2000000000 then raise exception 'INVALID_QUOTE'; end if;

  select * into v_row from public.custom_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_row.status is distinct from p_status then
    insert into public.custom_request_events (request_id, event, from_value, to_value, actor_id, actor_email)
    values (p_request_id, 'status_changed', v_row.status, p_status, (select auth.uid()), v_actor);
  end if;
  if v_row.assigned_to is distinct from v_assignee then
    insert into public.custom_request_events (request_id, event, from_value, to_value, actor_id, actor_email)
    values (p_request_id, 'assigned', v_row.assigned_to, v_assignee, (select auth.uid()), v_actor);
  end if;
  if v_row.quote_amount_fcfa is distinct from p_quote_amount_fcfa then
    insert into public.custom_request_events (request_id, event, from_value, to_value, actor_id, actor_email)
    values (p_request_id, 'quote_set', v_row.quote_amount_fcfa::text, p_quote_amount_fcfa::text, (select auth.uid()), v_actor);
  end if;

  update public.custom_requests
     set status = p_status, assigned_to = v_assignee, quote_amount_fcfa = p_quote_amount_fcfa
   where id = p_request_id;
end;
$$;

revoke all on function public.admin_update_custom_request(uuid, text, text, int4) from public, anon;
grant execute on function public.admin_update_custom_request(uuid, text, text, int4) to authenticated;

create function public.admin_add_custom_request_note(p_request_id uuid, p_kind text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'NOT_ADMIN'; end if;
  if p_kind is null or p_kind not in ('note', 'exchange') then raise exception 'INVALID_KIND'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'INVALID_BODY'; end if;
  if not exists (select 1 from public.custom_requests where id = p_request_id) then raise exception 'NOT_FOUND'; end if;
  insert into public.custom_request_notes (request_id, kind, body, author_id, author_email)
  values (p_request_id, p_kind, v_body, (select auth.uid()), (select auth.jwt() ->> 'email'))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_add_custom_request_note(uuid, text, text) from public, anon;
grant execute on function public.admin_add_custom_request_note(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 1.9 Conversion MANUELLE en commande (brouillon = commande « pending » / paiement « pending »)
--     Jamais automatique : uniquement par un administrateur, pour une demande ACCEPTÉE avec un montant de devis,
--     une seule fois (converted_order_id). N'appelle ni ne modifie create_order : la commande est insérée
--     directement avec une ligne libre (product_id nul) au montant du devis ; aucun stock n'est touché.
--     Livraison : seulement si une commune ET une adresse sont fournies, sinon retrait.
-- ---------------------------------------------------------------------
create function public.admin_convert_custom_request(
  p_request_id uuid,
  p_label      text,
  p_commune    text,
  p_address    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.custom_requests%rowtype;
  v_actor   text := (select auth.jwt() ->> 'email');
  v_label   text := btrim(coalesce(p_label, ''));
  v_commune text := btrim(coalesce(p_commune, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_method  text;
  v_order   uuid;
  v_ref     text;
begin
  if not coalesce((select public.is_admin()), false) then raise exception 'NOT_ADMIN'; end if;
  if char_length(v_label) < 3 or char_length(v_label) > 200 then raise exception 'INVALID_LABEL'; end if;

  select * into v_row from public.custom_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.converted_order_id is not null then raise exception 'ALREADY_CONVERTED'; end if;
  if v_row.status <> 'accepted' then raise exception 'NOT_ACCEPTED'; end if;
  if v_row.quote_amount_fcfa is null or v_row.quote_amount_fcfa <= 0 then raise exception 'NO_QUOTE'; end if;

  v_method := case when v_commune <> '' and v_address <> '' then 'delivery' else 'pickup' end;

  insert into public.orders (
    customer_id, customer_name, customer_email, customer_phone, customer_phone_digits,
    delivery_address, delivery_commune, customer_notes,
    subtotal_fcfa, delivery_fee_fcfa, total_fcfa,
    fulfillment_method, status, payment_method, payment_status)
  values (
    null, v_row.customer_name, coalesce(v_row.customer_email, ''), v_row.customer_phone, v_row.customer_phone_digits,
    nullif(v_address, ''), nullif(v_commune, ''), 'Création sur mesure ' || v_row.reference,
    v_row.quote_amount_fcfa, 0, v_row.quote_amount_fcfa,
    v_method, 'pending', 'cash_on_delivery', 'pending')
  returning id, reference into v_order, v_ref;

  insert into public.order_items (order_id, product_id, product_name, unit_price_fcfa, quantity, line_total_fcfa)
  values (v_order, null, v_label, v_row.quote_amount_fcfa, 1, v_row.quote_amount_fcfa);

  update public.custom_requests set converted_order_id = v_order where id = p_request_id;
  insert into public.custom_request_events (request_id, event, to_value, actor_id, actor_email)
  values (p_request_id, 'converted', v_ref, (select auth.uid()), v_actor);

  return jsonb_build_object('order_id', v_order, 'order_reference', v_ref);
end;
$$;

revoke all on function public.admin_convert_custom_request(uuid, text, text, text) from public, anon;
grant execute on function public.admin_convert_custom_request(uuid, text, text, text) to authenticated;

commit;


-- =====================================================================
-- PARTIE 2 — VÉRIFICATIONS APRÈS APPLICATION (lecture seule)
-- Résultat attendu : toutes les lignes "ok" = true.
-- =====================================================================
select 'tables créées (4)'                  as controle, (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'custom_request%') = 4 as ok
union all select 'RLS activée sur les 4 tables',      (select count(*) from pg_tables where schemaname = 'public' and tablename like 'custom_request%' and rowsecurity) = 4
union all select 'anon sans aucun droit de table',    not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name like 'custom_request%' and grantee = 'anon')
union all select 'authenticated : SELECT seulement',  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name like 'custom_request%' and grantee = 'authenticated' and privilege_type <> 'SELECT')
union all select 'bucket privé, 5 Mo, 3 types',       exists (select 1 from storage.buckets where id = 'meritt-custom-requests' and not public and file_size_limit = 5242880 and cardinality(allowed_mime_types) = 3)
union all select 'create_custom_request : anon peut exécuter',  has_function_privilege('anon', 'public.create_custom_request(uuid,text,text,text,text,text,text,text,text,text,int4,int4,int4,text,text,text,int4,text,text,text,date,boolean,jsonb,text)', 'execute')
union all select 'fonctions admin : anon ne peut pas',  not has_function_privilege('anon', 'public.admin_update_custom_request(uuid,text,text,int4)', 'execute')
                                                        and not has_function_privilege('anon', 'public.admin_add_custom_request_note(uuid,text,text)', 'execute')
                                                        and not has_function_privilege('anon', 'public.admin_convert_custom_request(uuid,text,text,text)', 'execute')
union all select 'aucune politique anon en lecture sur storage', not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Custom requests:%' and cmd = 'SELECT' and 'anon' = any (roles));


-- =====================================================================
-- PARTIE 3 — SCÉNARIOS DE TEST (PROJET DE TEST UNIQUEMENT — écrit puis ANNULE)
-- Le bloc se termine par une exception volontaire : tout est annulé. Lisez le message (« NOTICE » / erreur finale).
-- =====================================================================
-- do $$
-- declare
--   k uuid := gen_random_uuid();
--   r jsonb;
-- begin
--   r := public.create_custom_request(k, 'Client Test', '+225 07 00 00 00 99', null, 'Cocody', 'whatsapp', 'living', 'pinterest',
--          'https://www.pinterest.com/pin/123/', 'Un meuble TV en bois clair avec rangements.', null, null, null, null, null, null, 1, null,
--          'to_define', 'none', null, true, '[]'::jsonb, '');
--   if (r->>'idempotent_replay')::boolean then raise exception 'ECHEC: premier appel marqué rejeu'; end if;
--   r := public.create_custom_request(k, 'Client Test', '+225 07 00 00 00 99', null, 'Cocody', 'whatsapp', 'living', 'pinterest',
--          null, 'Un meuble TV en bois clair avec rangements.', null, null, null, null, null, null, 1, null, 'to_define', 'none', null, true, '[]'::jsonb, '');
--   if not (r->>'idempotent_replay')::boolean then raise exception 'ECHEC: double envoi non détecté'; end if;
--   begin
--     perform public.create_custom_request(gen_random_uuid(), 'X', '0700000099', null, null, 'whatsapp', 'living', null, 'http://pinterest.com/x',
--       'description suffisante', null, null, null, null, null, null, 1, null, 'to_define', 'none', null, true, '[]'::jsonb, '');
--     raise exception 'ECHEC: lien http accepté';
--   exception when others then
--     if sqlerrm not in ('INVALID_CUSTOMER', 'INVALID_URL') then raise; end if;
--   end;
--   raise exception 'TEST OK (annulé volontairement)';
-- end $$;


-- =====================================================================
-- Entretien : fichiers orphelins (envoyés mais jamais rattachés à une demande, > 24 h).
-- Lecture seule : à examiner puis supprimer depuis le tableau de bord Storage ou un administrateur.
-- =====================================================================
-- select o.name, o.created_at
-- from storage.objects o
-- where o.bucket_id = 'meritt-custom-requests'
--   and o.created_at < now() - interval '24 hours'
--   and not exists (select 1 from public.custom_request_images i where i.storage_path = o.name);


-- =====================================================================
-- PARTIE 4 — RETOUR ARRIÈRE (à n'exécuter qu'avec validation ; supprime TOUTES les demandes sur mesure)
-- =====================================================================
-- begin;
-- drop function if exists public.admin_convert_custom_request(uuid, text, text, text);
-- drop function if exists public.admin_add_custom_request_note(uuid, text, text);
-- drop function if exists public.admin_update_custom_request(uuid, text, text, int4);
-- drop function if exists public.create_custom_request(uuid, text, text, text, text, text, text, text, text, text, int4, int4, int4, text, text, text, int4, text, text, text, date, boolean, jsonb, text);
-- drop policy if exists "Custom requests: admins delete files" on storage.objects;
-- drop policy if exists "Custom requests: admins read files" on storage.objects;
-- drop policy if exists "Custom requests: upload under request folder" on storage.objects;
-- -- Vider d'abord le bucket depuis le tableau de bord Storage, puis :
-- -- delete from storage.buckets where id = 'meritt-custom-requests';
-- drop table if exists public.custom_request_events;
-- drop table if exists public.custom_request_notes;
-- drop table if exists public.custom_request_images;
-- drop table if exists public.custom_requests;
-- drop sequence if exists public.custom_request_seq;
-- commit;
