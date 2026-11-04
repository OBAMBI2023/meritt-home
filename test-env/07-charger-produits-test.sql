-- =====================================================================
-- MERITT HOME — CHARGEMENT DES PRODUITS DANS LE PROJET DE TEST UNIQUEMENT (kmjoyioeanjrvohmfash)
-- NE JAMAIS l'exécuter sur la production (jvmvsaiduralhezrjeyg) : vérifiez que l'URL de l'éditeur SQL contient « kmjoyioeanjrvohmfash ».
--
-- Contenu : 1 catégorie et 9 produits publiés, copiés tels quels depuis la production (lecture publique) :
-- mêmes identifiants, noms, descriptions, prix (FCFA), images et dates. Aucun prix modifié.
-- AUCUNE ligne de stock n'est créée (aucune quantité inventée) : tant qu'un stock n'est pas renseigné dans TEST, un produit
-- sans quantité est refusé à la commande (STOCK_UNTRACKED), comme en production.
-- Les images pointent vers le stockage PUBLIC de la production (lecture seule) ; remplaçables plus tard.
-- Idempotent : « on conflict do nothing » (rejouer ne duplique rien, ne modifie rien). Le produit « Produit Test » existant n'est pas touché.
-- Parties : 1 (écriture, une transaction) · 2 (contrôle, lecture seule) · 3 (retour arrière, commenté)
-- =====================================================================

-- PARTIE 1 — CHARGEMENT
begin;

insert into public.categories (id, name, slug, description, is_active, sort_order, created_at, updated_at) values
  ('affc554c-d24b-4919-9be2-2de87564e7eb', 'Tables', 'tables', null, true, 0, '2026-10-29T10:51:27.816563+00:00', '2026-10-29T10:51:27.816563+00:00')
on conflict do nothing;

insert into public.products (id, category_id, name, slug, description, price_fcfa, image_urls, is_published, created_at, updated_at) values
  ('b937ba18-74e0-401c-ba66-84afe9d5f2a5', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table à manger', 'table-a-manger', 'G', 100000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/0a67c67a-c9a3-41db-a165-da2061bb3821.png']::text[], true, '2026-10-29T10:51:50.579306+00:00', '2026-10-29T10:51:50.579306+00:00'),
  ('3dd11d81-aaeb-47cd-b641-c71ada946957', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table nuage pieds ronds', 'table-nuage-pieds-ronds', null, 175000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/da564a07-3668-4ffd-baac-6db8a6a7b55c.jpg']::text[], true, '2026-11-01T16:47:35.055623+00:00', '2026-11-01T17:22:42.056877+00:00'),
  ('e7d9d8bf-95b1-4fe9-9f84-db51c94e3314', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table vitrée pieds billes', 'table-vitree-pieds-billes', null, 180000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/e141419e-14e8-4b14-8d67-216daef1f518.jpg']::text[], true, '2026-11-01T16:48:23.444094+00:00', '2026-11-01T17:22:38.828425+00:00'),
  ('cf56729e-1887-4652-997e-f1337eb8fee2', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table duo de luxe', 'table-duo-de-luxe', 'Ensemble de deux tables : grande table 82 cm × H 39 cm et petite table 55 cm (plateau en verre) × H 50 cm. Cadre en fibre de verre, verre trempé haute dureté, finition peinture.', 330000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/4e51f35a-3246-4c8c-8cb5-bbb1f682d7c2.jpg']::text[], true, '2026-11-01T16:48:51.637482+00:00', '2026-11-01T16:50:06.571332+00:00'),
  ('a300764b-a4d7-4238-8ff4-c2ca5af1c058', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table ethnique duo', 'table-ethnique-duo', 'Ensemble de deux tables gigognes, une haute et une basse, en bois d’hévéa épaissi.', 135000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/95635055-3a6c-456d-9664-f5854afd6a05.jpg']::text[], true, '2026-11-01T16:49:19.034705+00:00', '2026-11-01T17:22:47.415686+00:00'),
  ('22a8246f-78bc-40ce-bd11-a1d46ece5047', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table nuage noire', 'table-nuage-noire', null, 140000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/ee35b8d1-e501-450a-ba2d-1e70677b09c0.jpg']::text[], true, '2026-11-01T16:49:44.391651+00:00', '2026-11-01T17:22:43.444963+00:00'),
  ('4c606f18-0a82-45fe-9004-270d1f5a5d55', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table nuage blanc crème', 'table-nuage-blanc-creme', 'Matière : bois (MDF).', 140000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/04498300-822b-4f8d-9e64-5d908c1490d9.jpg']::text[], true, '2026-11-01T16:50:10.12874+00:00', '2026-11-01T17:22:44.824684+00:00'),
  ('40ac5b25-4d8d-4982-9727-300bb604d6e2', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table pieds ronds', 'table-pieds-ronds', 'Dimensions : Ø 75 cm × H 30 cm.', 125000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/8b37eef9-1114-46b3-b283-62007393b415.jpg']::text[], true, '2026-11-01T16:50:36.259858+00:00', '2026-11-01T17:22:40.954424+00:00'),
  ('52a631a7-973c-41c2-a459-b7daa516484f', 'affc554c-d24b-4919-9be2-2de87564e7eb', 'Table pivotante blanc crème', 'table-pivotante-blanc-creme', 'Dimensions : 110 cm × 55 cm × H 30 cm.', 250000, array['https://jvmvsaiduralhezrjeyg.supabase.co/storage/v1/object/public/meritt-product-images/products/f466a00a-ffb5-4689-99fa-8e9a2dafe311.jpg']::text[], true, '2026-11-01T16:51:01.983877+00:00', '2026-11-01T17:22:39.90501+00:00')
on conflict do nothing;

commit;

-- PARTIE 2 — CONTRÔLE (lecture seule). Attendu : 10 produits publiés (9 copiés + « Produit Test »), 2 catégories, 0 ligne de stock ajoutée.
select (select count(*) from public.categories) as categories,
       (select count(*) from public.products where is_published) as produits_publies,
       (select count(*) from public.products p where p.id in ('b937ba18-74e0-401c-ba66-84afe9d5f2a5', '3dd11d81-aaeb-47cd-b641-c71ada946957', 'e7d9d8bf-95b1-4fe9-9f84-db51c94e3314', 'cf56729e-1887-4652-997e-f1337eb8fee2', 'a300764b-a4d7-4238-8ff4-c2ca5af1c058', '22a8246f-78bc-40ce-bd11-a1d46ece5047', '4c606f18-0a82-45fe-9004-270d1f5a5d55', '40ac5b25-4d8d-4982-9727-300bb604d6e2', '52a631a7-973c-41c2-a459-b7daa516484f')) as produits_copies,
       (select count(*) from public.product_inventory i where i.product_id in ('b937ba18-74e0-401c-ba66-84afe9d5f2a5', '3dd11d81-aaeb-47cd-b641-c71ada946957', 'e7d9d8bf-95b1-4fe9-9f84-db51c94e3314', 'cf56729e-1887-4652-997e-f1337eb8fee2', 'a300764b-a4d7-4238-8ff4-c2ca5af1c058', '22a8246f-78bc-40ce-bd11-a1d46ece5047', '4c606f18-0a82-45fe-9004-270d1f5a5d55', '40ac5b25-4d8d-4982-9727-300bb604d6e2', '52a631a7-973c-41c2-a459-b7daa516484f')) as lignes_de_stock_des_produits_copies;

-- PARTIE 3 — RETOUR ARRIÈRE (à n'exécuter qu'avec validation ; supprime uniquement les lignes copiées ci-dessus)
-- begin;
-- delete from public.products where id in ('b937ba18-74e0-401c-ba66-84afe9d5f2a5', '3dd11d81-aaeb-47cd-b641-c71ada946957', 'e7d9d8bf-95b1-4fe9-9f84-db51c94e3314', 'cf56729e-1887-4652-997e-f1337eb8fee2', 'a300764b-a4d7-4238-8ff4-c2ca5af1c058', '22a8246f-78bc-40ce-bd11-a1d46ece5047', '4c606f18-0a82-45fe-9004-270d1f5a5d55', '40ac5b25-4d8d-4982-9727-300bb604d6e2', '52a631a7-973c-41c2-a459-b7daa516484f');
-- delete from public.categories where id in ('affc554c-d24b-4919-9be2-2de87564e7eb');
-- commit;
