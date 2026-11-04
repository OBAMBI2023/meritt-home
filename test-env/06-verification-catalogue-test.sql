-- MERITT HOME — PROJET DE TEST UNIQUEMENT (kmjoyioeanjrvohmfash). LECTURE SEULE. A lancer APRES 05-migration-catalogue-test.sql.
-- Attendu : ok = true partout.
select 'products.inventory_mode'      as controle, exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='inventory_mode') as ok
union all select 'products.availability_status', exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='availability_status')
union all select 'products.lead_time',           exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='lead_time')
union all select 'order_items.inventory_mode',   exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='inventory_mode')
union all select 'get_catalogue_availability() existe', exists (select 1 from pg_proc where proname='get_catalogue_availability' and pronamespace='public'::regnamespace and pronargs=0)
union all select 'get_catalogue_availability executable par anon', has_function_privilege('anon','public.get_catalogue_availability()','execute')
union all select 'create_order executable par anon',    has_function_privilege('anon','public.create_order(uuid,text,text,text,text,text,text,text,jsonb,text)','execute')
union all select 'order_summary NON executable par anon', not has_function_privilege('anon','public.order_summary(uuid)','execute')
union all select 'site_banners existe',          to_regclass('public.site_banners') is not null
union all select 'site_banners : RLS activee',   coalesce((select relrowsecurity from pg_class where oid='public.site_banners'::regclass), false)
union all select 'site_banners : 2 policies',    (select count(*) from pg_policies where schemaname='public' and tablename='site_banners') = 2
union all select 'site_banners : anon lecture seule', has_table_privilege('anon','public.site_banners','select') and not has_table_privilege('anon','public.site_banners','insert');
