-- =====================================================================
-- MERITT HOME — ENVIRONNEMENT DE TEST : données de test (JAMAIS en production)
--
-- Prérequis : 01-schema-base.sql puis migration-commandes.sql (PARTIE 1) déjà appliqués dans le projet de TEST,
-- et un compte administrateur de test créé dans Authentication > Users (e-mail + mot de passe de test).
-- Remplacez REMPLACER_PAR_EMAIL_ADMIN_TEST ci-dessous par l'e-mail de ce compte.
--
-- GARDE-FOU : le script refuse de s'exécuter s'il détecte des données déjà présentes (catalogue ou commandes).
-- Toutes les valeurs sont FICTIVES et marquées « Test » : tarif, stock, adresse de retrait.
-- =====================================================================
do $$
begin
  if exists (select 1 from public.products) or exists (select 1 from public.orders) then
    raise exception 'ARRET : la base contient déjà des produits ou des commandes. Données de test refusées.';
  end if;
  if not exists (select 1 from auth.users where email = 'REMPLACER_PAR_EMAIL_ADMIN_TEST') then
    raise exception 'ARRET : aucun utilisateur ne porte l''e-mail REMPLACER_PAR_EMAIL_ADMIN_TEST. Créez d''abord le compte admin de test et corrigez l''e-mail.';
  end if;
end $$;

insert into public.admin_users (user_id)
  select id from auth.users where email = 'REMPLACER_PAR_EMAIL_ADMIN_TEST';

insert into public.categories (id, name, slug, is_active)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'Catégorie Test', 'categorie-test', true);

insert into public.products (id, category_id, name, slug, description, price_fcfa, is_published)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
          'Produit Test', 'produit-test', 'Produit fictif pour les tests de commande.', 25000, true);

insert into public.product_inventory (product_id, stock_quantity)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 5);

-- Zone de livraison de test (tarif fictif)
insert into public.delivery_fees (commune, fee_fcfa, is_active) values ('Zone Test', 1500, true);

-- Adresse de retrait de test (fictive)
update public.order_settings set pickup_address = 'ADRESSE DE TEST — retrait fictif' where id = true;
