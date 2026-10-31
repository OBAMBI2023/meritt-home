-- MERITT HOME — Bannières : RETOUR ARRIÈRE (À NE LANCER QU'EN CAS DE PROBLÈME)
-- Projet Supabase : jvmvsaiduralhezrjeyg
-- Supprime uniquement la table créée par migration-bannieres.sql (et ses politiques, trigger, droits).
-- Les bannières personnalisées enregistrées dans cette table seraient perdues ; la boutique
-- retomberait sur les bannières par défaut. Aucune autre table n'est touchée.
begin;
drop table public.site_banners;
notify pgrst, 'reload schema';
commit;
