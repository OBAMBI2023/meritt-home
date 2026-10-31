-- =====================================================================
-- MERITT HOME — ENVIRONNEMENT DE TEST : schéma de base (état AVANT la migration des commandes)
--
-- À exécuter UNIQUEMENT dans un projet Supabase de TEST, jamais dans la production
-- (jvmvsaiduralhezrjeyg). Il reproduit le schéma relevé lors de l'audit du 29/10/2026 :
-- tables, contraintes, fonctions, déclencheurs, RLS, politiques et droits.
-- Ordre d'exécution : 01-schema-base.sql -> migration-commandes.sql (PARTIE 1 seulement)
--                     -> 03-donnees-test.sql
--
-- GARDE-FOU : le script s'arrête si la base contient déjà la table public.orders.
-- STATUT : NON EXÉCUTÉ sur Supabase. Validé seulement sur une base PostgreSQL en mémoire (PGlite).
-- =====================================================================

do $$
begin
  if to_regclass('public.orders') is not null or to_regclass('public.products') is not null then
    raise exception 'ARRET : ce projet contient déjà des tables Meritt Home. Ce script est réservé à un projet de test vierge.';
  end if;
end $$;

create sequence public.order_reference_seq;

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  is_active   boolean not null default true,
  sort_order  int4 not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id) on delete restrict,
  name         text not null,
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description  text,
  price_fcfa   int4 not null check (price_fcfa >= 0),
  image_urls   text[] not null default '{}'::text[],
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);
create index products_published_idx on public.products (is_published);

create table public.product_inventory (
  product_id     uuid primary key references public.products(id) on delete cascade,
  stock_quantity int4 check (stock_quantity is null or stock_quantity >= 0),
  updated_at     timestamptz not null default now()
);

create table public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique
    default ('MH-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.order_reference_seq')::text, 6, '0')),
  customer_id       uuid references auth.users(id) on delete set null,
  customer_name     text not null,
  customer_email    text not null,
  customer_phone    text not null,
  delivery_address  text not null,
  delivery_commune  text not null,
  customer_notes    text,
  subtotal_fcfa     int4 not null check (subtotal_fcfa >= 0),
  delivery_fee_fcfa int4 not null default 0 check (delivery_fee_fcfa >= 0),
  total_fcfa        int4 not null,
  status            text not null default 'pending',
  payment_method    text not null default 'cash_on_delivery',
  payment_status    text not null default 'unpaid',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint orders_check check (total_fcfa >= 0 and total_fcfa = subtotal_fcfa + delivery_fee_fcfa),
  constraint orders_payment_method_check check (payment_method = 'cash_on_delivery'),
  constraint orders_payment_status_check check (payment_status = any (array['unpaid','pending','paid','failed','refunded'])),
  constraint orders_status_check check (status = any (array['pending','confirmed','preparing','shipped','delivered','cancelled']))
);
create index orders_customer_idx on public.orders (customer_id);
create index orders_created_idx on public.orders (created_at desc);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete restrict,
  product_id      uuid references public.products(id) on delete set null,
  product_name    text not null,
  unit_price_fcfa int4 not null check (unit_price_fcfa >= 0),
  quantity        int4 not null check (quantity >= 1 and quantity <= 10),
  line_total_fcfa int4 not null,
  created_at      timestamptz not null default now(),
  constraint order_items_check check (line_total_fcfa >= 0 and line_total_fcfa = unit_price_fcfa * quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

-- Fonctions (identiques à la production)
create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())); $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := pg_catalog.now(); return new; end; $$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger inventory_set_updated_at before update on public.product_inventory for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();

-- RLS et politiques (identiques à la production, avant la migration)
alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.order_items enable row level security;
alter table public.orders enable row level security;
alter table public.product_inventory enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;

create policy "Admins read admin assignments" on public.admin_users for select to authenticated using ((select public.is_admin()));
create policy "Users read own admin assignment" on public.admin_users for select to authenticated using (user_id = (select auth.uid()));
create policy "Admins manage categories" on public.categories for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Public reads active categories" on public.categories for select to anon, authenticated using (is_active = true);
create policy "Admins read all order items" on public.order_items for select to authenticated using ((select public.is_admin()));
create policy "Customers read own order items" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = (select auth.uid())));
create policy "Admins read all orders" on public.orders for select to authenticated using ((select public.is_admin()));
create policy "Admins update order status" on public.orders for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Customers read own orders" on public.orders for select to authenticated using (customer_id = (select auth.uid()));
create policy "Admins manage inventory" on public.product_inventory for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins manage products" on public.products for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Public reads published products" on public.products for select to anon, authenticated
  using (is_published = true and exists (select 1 from public.categories c where c.id = products.category_id and c.is_active = true));
create policy "Users create own profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "Users read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Admins read profiles" on public.profiles for select to authenticated using ((select public.is_admin()));

-- Droits : on repart de zéro (un projet Supabase neuf accorde des droits par défaut) puis on reproduit exactement la production.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.admin_users to authenticated;
grant select on public.categories to anon;
grant select, insert, update, delete on public.categories to authenticated;
grant select on public.order_items to authenticated;
grant select on public.orders to authenticated;
grant select, insert, update, delete on public.product_inventory to authenticated;
grant select on public.products to anon;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update on public.profiles to authenticated;
