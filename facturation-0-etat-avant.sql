-- MERITT HOME — Module de facturation : ÉTAT AVANT INSTALLATION (LECTURE SEULE, aucune écriture)
-- Projet Supabase de production : jvmvsaiduralhezrjeyg
--
-- À exécuter AVANT facturation-1-migration.sql. Une seule instruction « select » : le résultat s'affiche en un seul tableau.
-- Colonne ok : true = conforme à l'attendu, false = ANOMALIE (arrêtez-vous et envoyez-moi le tableau), vide = information.
-- Attendu pour installer : toutes les lignes ok = true (les lignes « information » n'ont pas de valeur ok).
-- Aucune donnée de commande n'est lue : seulement des comptages.
select 'A prérequis' as section, 'is_admin() existe' as controle,
       exists (select 1 from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace) as ok, null::text as detail
union all select 'A prérequis', 'set_updated_at() existe',
       exists (select 1 from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace), null
union all select 'A prérequis', 'migration commandes appliquée (orders.fulfillment_method)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name::text = 'fulfillment_method'), null
union all select 'A prérequis', 'migration commandes appliquée (order_items.stock_decremented)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name::text = 'stock_decremented'), null
union all select 'A prérequis', 'create_order() existe',
       exists (select 1 from pg_proc where proname = 'create_order' and pronamespace = 'public'::regnamespace), null
union all select 'A prérequis', 'PostgreSQL 15 ou plus (vues security_invoker)',
       current_setting('server_version_num')::int >= 150000, current_setting('server_version')

union all select 'B encaissements (déjà appliqué)', '3 tables de paiement présentes',
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname::text in ('payment_methods', 'order_payments', 'order_payment_events')) = 3, null
union all select 'B encaissements (déjà appliqué)', 'vue v_order_payments présente',
       to_regclass('public.v_order_payments') is not null, null
union all select 'B encaissements (déjà appliqué)', 'v_order_payments en security_invoker',
       coalesce((select reloptions::text like '%security_invoker=true%' from pg_class where oid = to_regclass('public.v_order_payments')), false), null
union all select 'B encaissements (déjà appliqué)', '7 fonctions de paiement présentes',
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname::text in ('record_payment', 'confirm_payment', 'set_payment_status', 'payments_summary', 'payment_summary', 'payment_recalc_order', 'payments_guard')) = 7, null
union all select 'B encaissements (déjà appliqué)', '4 triggers de paiement présents',
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
           and t.tgname::text in ('payment_methods_set_updated_at', 'order_payments_set_updated_at', 'order_payments_guard', 'order_payment_events_guard')) = 4, null
union all select 'B encaissements (déjà appliqué)', '3 politiques de paiement présentes',
       (select count(*) from pg_policies where schemaname = 'public'
          and policyname::text in ('Admins manage payment methods', 'Admins read payments', 'Admins read payment events')) = 3, null
union all select 'B encaissements (déjà appliqué)', 'RLS actif sur les 3 tables de paiement',
       coalesce((select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname::text in ('payment_methods', 'order_payments', 'order_payment_events')), false), null
union all select 'B encaissements (déjà appliqué)', 'colonnes lues par la facturation : order_payments(order_id, amount_fcfa, status)',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'order_payments' and column_name::text in ('order_id', 'amount_fcfa', 'status')) = 3, null
union all select 'B encaissements (déjà appliqué)', 'index unique de référence de paiement présent',
       exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i' and relname::text = 'order_payments_reference_key'), null

union all select 'C facturation (doit être ABSENTE)', '5 tables de facturation absentes',
       not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace
                     and relname::text in ('company_settings', 'invoice_counters', 'invoices', 'invoice_lines', 'invoice_events')), null
union all select 'C facturation (doit être ABSENTE)', 'vue v_invoices absente',
       to_regclass('public.v_invoices') is null, null
union all select 'C facturation (doit être ABSENTE)', '7 fonctions de facturation absentes',
       not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                     and proname::text in ('invoices_guard', 'invoice_summary', 'create_invoice_draft', 'update_invoice_draft', 'issue_invoice', 'cancel_invoice', 'invoices_summary')), null
union all select 'C facturation (doit être ABSENTE)', 'aucun trigger de facturation',
       not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relnamespace = 'public'::regnamespace and t.tgname::text in ('company_settings_set_updated_at', 'invoices_set_updated_at', 'invoices_guard', 'invoice_lines_guard', 'invoice_events_guard')), null
union all select 'C facturation (doit être ABSENTE)', 'aucune politique de facturation',
       not exists (select 1 from pg_policies where schemaname = 'public'
                    and policyname::text in ('Admins manage company settings', 'Admins read invoices', 'Admins read invoice lines', 'Admins read invoice events')), null
union all select 'C facturation (doit être ABSENTE)', 'aucun index homonyme',
       not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i'
                    and relname::text in ('invoices_order_idx', 'invoices_issued_idx', 'invoices_status_idx', 'invoices_one_active_per_order', 'invoice_events_invoice_idx')), null

union all select 'D commande réelle (information, comptages seulement)', 'nombre de commandes', null::boolean, (select count(*) from public.orders)::text
union all select 'D commande réelle (information, comptages seulement)', 'nombre de lignes de commande', null::boolean, (select count(*) from public.order_items)::text
union all select 'D commande réelle (information, comptages seulement)', 'nombre de paiements enregistrés', null::boolean, (select count(*) from public.order_payments)::text
union all select 'D commande réelle (information, comptages seulement)', 'nombre de colonnes de la table orders', null::boolean,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders')::text;
