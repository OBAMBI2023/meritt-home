-- MERITT HOME — Module de facturation : VÉRIFICATIONS APRÈS (PARTIE 2 de migration-factures.sql, copiée à l'identique)
-- LECTURE SEULE. Attendu : les 9 lignes ok = true. (Le contrôle « réglages entreprise vides » n'a de sens que juste
-- après l'installation, tant que vous n'avez pas saisi les informations de l'entreprise.)
-- Les lignes ci-dessous sont identiques aux lignes 457 à 471 de migration-factures.sql.
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
