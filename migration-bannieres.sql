-- =====================================================================
-- MERITT HOME — Bannières personnalisables : migration additive (APPLIQUÉE — voir STATUT)
-- Projet Supabase : jvmvsaiduralhezrjeyg
--
-- STATUT : APPLIQUÉE en production (31/10/2026) : les 8 contrôles de verification-bannieres-apres-corrige.sql
-- renvoient ok = true. NE PAS rejouer : « create table » échouerait (42P07, relation déjà existante) et la
-- transaction serait annulée sans rien écrire. Le texte ci-dessous est conservé tel qu'il a été audité.
-- Avant application, la boutique affichait les bannières par défaut (lib/banners.ts).
--
-- ORDRE D'EXÉCUTION (chaque fichier séparément dans l'éditeur SQL) :
--   1. verification-bannieres-avant.sql   (lecture seule)  -> toutes les lignes ok = true
--   2. migration-bannieres.sql            (ce fichier)
--   3. verification-bannieres-apres.sql   (lecture seule)  -> toutes les lignes ok = true
--   retour-arriere-bannieres.sql          (SEULEMENT en cas de problème)
--
-- PORTÉE : crée UNE nouvelle table (public.site_banners), son trigger, ses 2 politiques RLS
-- et ses droits. Aucune table, fonction, politique ou donnée existante n'est lue ni modifiée.
-- Si la table existe déjà, « create table » échoue et la transaction est annulée (rien n'est écrit).
-- Prérequis : public.is_admin() et public.set_updated_at() (présentes d'après audit-schema.md).
-- =====================================================================

begin;

create table public.site_banners (
  id         boolean primary key default true check (id),   -- une seule ligne possible
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_banners (id) values (true);

create trigger site_banners_set_updated_at
  before update on public.site_banners
  for each row execute function public.set_updated_at();

alter table public.site_banners enable row level security;

create policy "Anyone reads site banners" on public.site_banners
  for select to anon, authenticated using (true);
create policy "Admins write site banners" on public.site_banners
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Droits explicites : on retire tout puis on n'accorde que le nécessaire
-- (les droits par défaut du schéma public peuvent varier selon le projet).
revoke all on public.site_banners from anon, authenticated;
grant select on public.site_banners to anon;
grant select, insert, update on public.site_banners to authenticated;

-- Demande à l'API (PostgREST) de recharger son cache de schéma : la table est vue immédiatement.
notify pgrst, 'reload schema';

commit;
