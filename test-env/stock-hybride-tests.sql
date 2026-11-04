-- =====================================================================
-- MERITT HOME — Scénarios SQL du stock hybride (PROJET DE TEST UNIQUEMENT, APRÈS migration-stock-hybride.sql PARTIE 1)
--
-- Le bloc écrit des données de test (catégorie, 7 produits, commandes) puis lève volontairement une exception finale :
-- TOUT est annulé automatiquement (seuls les compteurs de séquence, non transactionnels, avancent). Le rapport est
-- le texte de cette exception : « RAPPORT : N/N scénarios réussis » ou la liste des échecs.
-- NE JAMAIS l'exécuter sur la production. Le scénario « deux commandes simultanées » est dans e2e-stock-hybride.mjs.
-- =====================================================================
do $$
declare
  v_cat       uuid;
  p_stock     uuid;  -- suivi, stock 5
  p_zero      uuid;  -- suivi, stock 0
  p_nodata    uuid;  -- suivi, aucune ligne de stock
  p_od        uuid;  -- sur commande, sans ligne de stock, délai renseigné
  p_od_stock  uuid;  -- sur commande, avec une quantité 7 (conservée, sans effet)
  p_unavail   uuid;  -- indisponible (suivi, stock 5)
  p_draft     uuid;  -- non publié (suivi, stock 5)
  v_policy    text;
  v_n         int := 0;
  v_fail      text := '';
  v_phone     int := 0;
  v_res       text;
  v_qty       int;
  v_item      record;
  v_orders    int;
begin
  -- Fonction temporaire de test (supprimée avec la session) : tente une commande d'une ligne ;
  -- retourne 'OK' ou 'CODE|détail' (détail = identifiant du produit).
  execute $f$
    create or replace function pg_temp.try_order(p_items jsonb, p_phone text) returns text language plpgsql as $g$
    declare v_detail text;
    begin
      perform public.create_order(gen_random_uuid(), 'Client Test', 'test@example.com', p_phone, 'pickup', null, null, null, p_items, '');
      return 'OK';
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      return sqlerrm || '|' || coalesce(v_detail, '');
    end $g$
  $f$;

  select untracked_stock_policy into v_policy from public.order_settings limit 1;
  update public.order_settings set untracked_stock_policy = 'reject';  -- annulé en fin de test

  -- Fixtures
  insert into public.categories (name, slug, is_active) values ('Test stock hybride', 'test-stock-hybride-' || substr(gen_random_uuid()::text, 1, 8), true) returning id into v_cat;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status, lead_time)
  values (v_cat, 'T suivi', 'ts-' || substr(gen_random_uuid()::text, 1, 8), 10000, true, 'tracked', 'available', null) returning id into p_stock;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'T zéro', 'tz-' || substr(gen_random_uuid()::text, 1, 8), 10000, true, 'tracked', 'available') returning id into p_zero;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'T sans stock', 'tn-' || substr(gen_random_uuid()::text, 1, 8), 10000, true, 'tracked', 'available') returning id into p_nodata;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status, lead_time)
  values (v_cat, 'T sur commande', 'to-' || substr(gen_random_uuid()::text, 1, 8), 20000, true, 'on_demand', 'available', '2 semaines') returning id into p_od;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'T sur commande avec quantité', 'tq-' || substr(gen_random_uuid()::text, 1, 8), 20000, true, 'on_demand', 'available') returning id into p_od_stock;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'T indisponible', 'tu-' || substr(gen_random_uuid()::text, 1, 8), 10000, true, 'tracked', 'unavailable') returning id into p_unavail;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'T brouillon', 'td-' || substr(gen_random_uuid()::text, 1, 8), 10000, false, 'tracked', 'available') returning id into p_draft;
  insert into public.product_inventory (product_id, stock_quantity) values (p_stock, 5), (p_zero, 0), (p_od_stock, 7), (p_unavail, 5), (p_draft, 5);

  -- Aide : numéro de téléphone distinct pour chaque tentative (limite par numéro).
  -- 1. Produit en stock, quantité suffisante : commande acceptée ; stock 5 -> 3
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_stock, 'quantity', 2)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_stock;
  if v_res <> 'OK' or v_qty <> 3 then v_fail := v_fail || E'\n1: attendu OK et stock 3, obtenu ' || v_res || ' / ' || coalesce(v_qty::text, 'NULL'); end if;

  -- 2. Quantité insuffisante : refusée avec l'identifiant du produit ; stock inchangé (3)
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_stock, 'quantity', 4)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_stock;
  if v_res <> 'INSUFFICIENT_STOCK|' || p_stock::text or v_qty <> 3 then v_fail := v_fail || E'\n2: attendu INSUFFICIENT_STOCK + id, obtenu ' || v_res || ' / stock ' || coalesce(v_qty::text, 'NULL'); end if;

  -- 3. Quantité nulle : refusée
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_zero, 'quantity', 1)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  if v_res <> 'INSUFFICIENT_STOCK|' || p_zero::text then v_fail := v_fail || E'\n3: attendu INSUFFICIENT_STOCK, obtenu ' || v_res; end if;

  -- 3b. Produit suivi sans quantité renseignée (politique « reject ») : refusé (STOCK_UNTRACKED)
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_nodata, 'quantity', 1)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  if v_res <> 'STOCK_UNTRACKED|' || p_nodata::text then v_fail := v_fail || E'\n3b: attendu STOCK_UNTRACKED, obtenu ' || v_res; end if;

  -- 4. Produit sur commande sans quantité : accepté
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_od, 'quantity', 3)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  if v_res <> 'OK' then v_fail := v_fail || E'\n4: attendu OK, obtenu ' || v_res; end if;
  select count(*) into v_orders from public.product_inventory where product_id = p_od;
  if v_orders <> 0 then v_fail := v_fail || E'\n4: une ligne de stock a été créée pour un produit sur commande'; end if;

  -- 5. Produit sur commande avec une quantité : aucun décrément (7 reste 7), ligne de commande 0 décrémenté + mode conservé
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_od_stock, 'quantity', 2)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_od_stock;
  select oi.inventory_mode, oi.stock_decremented, oi.lead_time into v_item from public.order_items oi where oi.product_id = p_od_stock;
  if v_res <> 'OK' or v_qty <> 7 or v_item.inventory_mode <> 'on_demand' or v_item.stock_decremented <> 0 then
    v_fail := v_fail || E'\n5: attendu OK, stock 7, mode on_demand, 0 décrémenté ; obtenu ' || v_res || ' / ' || coalesce(v_qty::text, 'NULL') || ' / ' || coalesce(v_item.inventory_mode, 'NULL') || ' / ' || coalesce(v_item.stock_decremented::text, 'NULL');
  end if;
  select oi.lead_time into v_res from public.order_items oi where oi.product_id = p_od order by oi.created_at limit 1;
  if v_res is distinct from '2 semaines' then v_fail := v_fail || E'\n5: délai « 2 semaines » non conservé sur la ligne (obtenu ' || coalesce(v_res, 'NULL') || ')'; end if;

  -- 6. Produit indisponible : refusé même avec du stock
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_unavail, 'quantity', 1)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_unavail;
  if v_res <> 'PRODUCT_UNAVAILABLE|' || p_unavail::text or v_qty <> 5 then v_fail := v_fail || E'\n6: attendu PRODUCT_UNAVAILABLE et stock 5, obtenu ' || v_res || ' / ' || coalesce(v_qty::text, 'NULL'); end if;

  -- 7. Produit non publié : refusé
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_draft, 'quantity', 1)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  if v_res <> 'PRODUCT_NOT_PUBLISHED|' || p_draft::text then v_fail := v_fail || E'\n7: attendu PRODUCT_NOT_PUBLISHED, obtenu ' || v_res; end if;

  -- 7b. Produit introuvable
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-000000000001', 'quantity', 1)), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  if v_res <> 'PRODUCT_NOT_FOUND|00000000-0000-4000-8000-000000000001' then v_fail := v_fail || E'\n7b: attendu PRODUCT_NOT_FOUND, obtenu ' || v_res; end if;

  -- 8. « Variante » invalide : le schéma n'a pas de variantes ; une ligne mal formée (quantité non numérique) est refusée
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_stock, 'quantity', 'x')), '07000000' || lpad(v_phone::text, 2, '0')); v_n := v_n + 1;
  if split_part(v_res, '|', 1) <> 'INVALID_ITEMS' then v_fail := v_fail || E'\n8: attendu INVALID_ITEMS, obtenu ' || v_res; end if;

  -- 10. Changement de mode : la ligne de commande déjà créée garde son mode d'origine ; la quantité est conservée
  update public.products set inventory_mode = 'on_demand' where id = p_stock;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_stock;
  select oi.inventory_mode, oi.stock_decremented into v_item from public.order_items oi where oi.product_id = p_stock;
  v_n := v_n + 1;
  if v_qty <> 3 or v_item.inventory_mode <> 'tracked' or v_item.stock_decremented <> 2 then
    v_fail := v_fail || E'\n10: historique altéré après changement de mode (stock ' || coalesce(v_qty::text, 'NULL') || ', ligne ' || coalesce(v_item.inventory_mode, 'NULL') || '/' || coalesce(v_item.stock_decremented::text, 'NULL') || ')';
  end if;
  v_phone := v_phone + 1; v_res := pg_temp.try_order(jsonb_build_array(jsonb_build_object('product_id', p_stock, 'quantity', 9)), '07000000' || lpad(v_phone::text, 2, '0'));
  select stock_quantity into v_qty from public.product_inventory where product_id = p_stock;
  if v_res <> 'OK' or v_qty <> 3 then v_fail := v_fail || E'\n10: après passage en sur commande, quantité 9 attendue acceptée sans décrément (stock 3) ; obtenu ' || v_res || ' / ' || coalesce(v_qty::text, 'NULL'); end if;

  -- Signal public : jamais de quantité, seulement en stock / épuisé / NULL (sur commande)
  v_n := v_n + 1;
  if (select count(*) from public.get_catalogue_availability() g where g.product_id in (p_zero, p_od, p_stock) and
        ((g.product_id = p_zero and g.in_stock is distinct from false) or (g.product_id = p_od and g.in_stock is not null) or (g.product_id = p_stock and g.in_stock is not null))) > 0 then
    v_fail := v_fail || E'\nsignal public : valeurs inattendues pour get_catalogue_availability()';
  end if;

  -- Restauration (de toute façon annulée) puis rapport
  update public.order_settings set untracked_stock_policy = v_policy;
  if v_fail = '' then
    raise exception 'RAPPORT : % / % scénarios réussis (tout est annulé volontairement)', v_n, v_n;
  else
    raise exception 'RAPPORT : ÉCHECS (sur % scénarios) :%', v_n, v_fail;
  end if;
end $$;
