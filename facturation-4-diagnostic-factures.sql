-- MERITT HOME — Facturation : DIAGNOSTIC du contrôle « aucune facture (rien d'inventé) » (LECTURE SEULE, aucune écriture)
-- Projet Supabase de production : jvmvsaiduralhezrjeyg
--
-- Le contrôle d'origine vaut : (select count(*) from public.invoices) = 0. Il ne peut donc être false que si au moins une
-- ligne existe dans public.invoices (count(*) n'est jamais NULL). Cette requête compte seulement : aucun nom, e-mail,
-- téléphone, adresse ni montant n'est affiché.
-- Une seule instruction « select » : le résultat s'affiche en un seul tableau (colonnes controle, valeur).
select 'contrôle d''origine reproduit : count(*) = 0' as controle, ((select count(*) from public.invoices) = 0)::text as valeur
union all select 'nombre de factures (toutes)', count(*)::text from public.invoices
union all select 'brouillons (draft)', count(*)::text from public.invoices where status = 'draft'
union all select 'émises (issued)', count(*)::text from public.invoices where status = 'issued'
union all select 'annulées (cancelled)', count(*)::text from public.invoices where status = 'cancelled'
union all select 'factures avec numéro attribué', count(*) filter (where number is not null)::text from public.invoices
union all select 'commandes distinctes concernées', count(distinct order_id)::text from public.invoices
union all select 'première création (UTC)', coalesce(min(created_at)::text, '-') from public.invoices
union all select 'dernière création (UTC)', coalesce(max(created_at)::text, '-') from public.invoices
union all select 'lignes de facture', count(*)::text from public.invoice_lines
union all select 'événements d''historique', count(*)::text from public.invoice_events
union all select 'types d''événements', coalesce(string_agg(distinct event, ', '), '-') from public.invoice_events
union all select 'lignes du compteur annuel (0 = aucune facture émise)', count(*)::text from public.invoice_counters
union all select 'réglages entreprise : nom renseigné', coalesce((select (company_name is not null)::text from public.company_settings limit 1), 'aucune ligne');
