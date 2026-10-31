-- MERITT HOME — Bannières : contrôles APRÈS migration (LECTURE SEULE, aucune écriture)
-- Projet Supabase : jvmvsaiduralhezrjeyg
-- Résultat attendu : toutes les lignes ok = true.
select 'table site_banners existe' as controle,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'site_banners') as ok
union all select 'colonnes id boolean, data jsonb, updated_at timestamptz',
       (select count(*) = 3 from information_schema.columns
         where table_schema = 'public' and table_name = 'site_banners'
           and (column_name, data_type) in (('id','boolean'), ('data','jsonb'), ('updated_at','timestamp with time zone')))
union all select 'RLS activé',
       coalesce((select relrowsecurity from pg_class where oid = 'public.site_banners'::regclass), false)
union all select '2 politiques attendues',
       (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'site_banners'
         and policyname in ('Anyone reads site banners', 'Admins write site banners'))
union all select 'trigger updated_at présent',
       exists (select 1 from pg_trigger where tgrelid = 'public.site_banners'::regclass and tgname = 'site_banners_set_updated_at' and not tgisinternal)
union all select 'anon : SELECT seulement',
       (select coalesce(array_agg(privilege_type order by privilege_type), '{}') = array['SELECT']
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'site_banners' and grantee = 'anon')
union all select 'authenticated : INSERT, SELECT, UPDATE (pas de DELETE)',
       (select coalesce(array_agg(privilege_type order by privilege_type), '{}') = array['INSERT','SELECT','UPDATE']
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'site_banners' and grantee = 'authenticated')
union all select 'une seule ligne de réglages',
       (select count(*) = 1 from public.site_banners);
