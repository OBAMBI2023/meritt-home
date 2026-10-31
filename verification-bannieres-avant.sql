-- MERITT HOME — Bannières : contrôles AVANT migration (LECTURE SEULE, aucune écriture)
-- Projet Supabase : jvmvsaiduralhezrjeyg
-- Utile uniquement AVANT la migration. Depuis son application en production, le dernier contrôle (table absente) vaut
-- logiquement false : ce n'est plus une anomalie.
-- Résultat attendu pour appliquer migration-bannieres.sql : toutes les lignes ok = true.
select 'is_admin() existe' as controle,
       exists (select 1 from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace) as ok
union all select 'set_updated_at() existe',
       exists (select 1 from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace)
union all select 'authenticated peut exécuter is_admin()',
       has_function_privilege('authenticated', 'public.is_admin()', 'execute')
union all select 'table site_banners absente (migration pas encore appliquée)',
       not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'site_banners');
