-- MERITT HOME — Module de facturation : CONTRÔLES DE STRUCTURE APRÈS INSTALLATION (LECTURE SEULE, aucune écriture)
-- Projet Supabase de production : jvmvsaiduralhezrjeyg
--
-- À exécuter APRÈS facturation-1-migration.sql, en complément de facturation-2-verifications-apres.sql.
-- Une seule instruction « select ». ok = true : conforme ; false : anomalie (arrêtez-vous) ; vide : information.
-- Les comptages de la section G doivent être IDENTIQUES à ceux de la section D de facturation-0-etat-avant.sql
-- (l'installation ne touche pas aux commandes, lignes de commande ni paiements).
select 'A tables' as section, '5 tables de facturation présentes' as controle,
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
          and relname::text in ('company_settings', 'invoice_counters', 'invoices', 'invoice_lines', 'invoice_events')) = 5 as ok, null::text as detail
union all select 'A tables', 'vue v_invoices présente, en security_invoker',
       coalesce((select reloptions::text like '%security_invoker=true%' from pg_class where oid = to_regclass('public.v_invoices')), false), null
union all select 'A tables', 'colonnes clés de invoices (8)',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
          and column_name::text in ('id', 'number', 'order_id', 'status', 'total_fcfa', 'company_snapshot', 'replaces_invoice_id', 'cancel_reason')) = 8, null
union all select 'A tables', 'colonnes clés des autres tables (invoice_lines 3, invoice_events 2, company_settings 2, invoice_counters 2)',
       (select count(*) from information_schema.columns where table_schema = 'public'
          and ((table_name = 'invoice_lines' and column_name::text in ('invoice_id', 'position', 'line_total_fcfa'))
            or (table_name = 'invoice_events' and column_name::text in ('invoice_id', 'event'))
            or (table_name = 'company_settings' and column_name::text in ('company_name', 'due_days'))
            or (table_name = 'invoice_counters' and column_name::text in ('year', 'last_number')))) = 9, null

union all select 'B contraintes', '6 contraintes de cohérence présentes (totaux, numéro, émission, annulation, lignes)',
       (select count(*) from pg_constraint where connamespace = 'public'::regnamespace
          and conname::text in ('invoices_total_check', 'invoices_number_check', 'invoices_issued_check', 'invoices_cancel_check', 'invoice_lines_check', 'invoice_lines_position_key')) = 6, null
union all select 'B contraintes', 'clé étrangère invoices.order_id -> orders en RESTRICT (une commande ne peut pas être supprimée si facturée)',
       exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'f' and confrelid = 'public.orders'::regclass and confdeltype = 'r'), null
union all select 'B contraintes', 'clés étrangères des lignes et de l''historique vers invoices en RESTRICT',
       (select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.invoices'::regclass and confdeltype = 'r'
          and conrelid in ('public.invoice_lines'::regclass, 'public.invoice_events'::regclass, 'public.invoices'::regclass)) = 3, null

union all select 'C index', '5 index nommés présents',
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i'
          and relname::text in ('invoices_order_idx', 'invoices_issued_idx', 'invoices_status_idx', 'invoices_one_active_per_order', 'invoice_events_invoice_idx')) = 5, null
union all select 'C index', 'une seule facture ACTIVE par commande (index unique partiel brouillon/émise)',
       coalesce((select i.indisunique and pg_get_indexdef(c.oid) like '%WHERE%' from pg_class c join pg_index i on i.indexrelid = c.oid
                  where c.relnamespace = 'public'::regnamespace and c.relname::text = 'invoices_one_active_per_order'), false), null
union all select 'C index', 'numéro de facture unique',
       exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i' and relname::text = 'invoices_number_key'), null

union all select 'D triggers', '5 triggers présents et activés',
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled = 'O'
           and t.tgname::text in ('company_settings_set_updated_at', 'invoices_set_updated_at', 'invoices_guard', 'invoice_lines_guard', 'invoice_events_guard')) = 5, null

union all select 'E politiques RLS', '4 politiques présentes avec la bonne commande (ALL / SELECT) et pour authenticated seulement',
       (select count(*) from pg_policies where schemaname = 'public' and roles::text = '{authenticated}'
          and ((policyname::text = 'Admins manage company settings' and cmd::text = 'ALL')
            or (policyname::text in ('Admins read invoices', 'Admins read invoice lines', 'Admins read invoice events') and cmd::text = 'SELECT'))) = 4, null
union all select 'E politiques RLS', 'aucune politique sur invoice_counters (accessible uniquement par les fonctions)',
       not exists (select 1 from pg_policies where schemaname = 'public' and tablename::text = 'invoice_counters'), null

union all select 'F fonctions', '7 fonctions présentes (6 SECURITY DEFINER + le garde-fou des triggers)',
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname::text in ('invoices_guard', 'invoice_summary', 'create_invoice_draft', 'update_invoice_draft', 'issue_invoice', 'cancel_invoice', 'invoices_summary')) = 7, null
union all select 'F fonctions', 'le garde-fou invoices_guard n''est pas exécutable par les rôles API',
       not has_function_privilege('authenticated', 'public.invoices_guard()', 'execute') and not has_function_privilege('anon', 'public.invoices_guard()', 'execute'), null

union all select 'G commande réelle (information, comptages seulement)', 'nombre de commandes', null::boolean, (select count(*) from public.orders)::text
union all select 'G commande réelle (information, comptages seulement)', 'nombre de lignes de commande', null::boolean, (select count(*) from public.order_items)::text
union all select 'G commande réelle (information, comptages seulement)', 'nombre de paiements enregistrés', null::boolean, (select count(*) from public.order_payments)::text
union all select 'G commande réelle (information, comptages seulement)', 'nombre de colonnes de la table orders', null::boolean,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders')::text
union all select 'G commande réelle (information, comptages seulement)', 'nombre de factures', null::boolean, (select count(*) from public.invoices)::text;
