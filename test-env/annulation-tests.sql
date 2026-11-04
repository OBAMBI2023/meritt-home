-- =====================================================================
-- MERITT HOME — Scénarios SQL d'annulation et de restitution du stock (PROJET DE TEST UNIQUEMENT)
-- À lancer APRÈS migration-stock-hybride.sql ET migration-historique-annulation.sql (PARTIE 1), jamais avant.
--
-- Le bloc écrit des données de test (catégorie, produits, commandes, lignes d'historique) puis lève volontairement une
-- exception finale : TOUT est annulé automatiquement (seuls les compteurs de séquence, non transactionnels, avancent).
-- Le rapport est le texte de cette exception : « RAPPORT : N/N contrôles réussis » ou la liste des échecs.
-- NE JAMAIS l'exécuter sur la production. Vérifiez que l'URL de l'éditeur SQL contient « kmjoyioeanjrvohmfash ».
-- Prérequis : au moins un administrateur dans public.admin_users (compte de test).
-- =====================================================================
do $$
declare
  v_admin   uuid := (select user_id from public.admin_users limit 1);
  v_cat     uuid;
  p_track   uuid;  -- suivi, stock 5
  p_od      uuid;  -- sur commande, sans ligne de stock
  p_null    uuid;  -- suivi, stock mis à NULL après la commande (restitution impossible)
  v_order   uuid;
  v_res     jsonb;
  v_qty     int;
  v_cnt     int;
  v_n       int := 0;
  v_fail    text := '';
  v_phone   int := 0;
  v_msg     text;
begin
  if v_admin is null then raise exception 'ARRET : aucun administrateur dans public.admin_users.'; end if;

  -- Fonction temporaire : crée une commande de retrait (pickup) et renvoie son id.
  execute $f$
    create or replace function pg_temp.mk_order(p_items jsonb, p_phone text) returns uuid language plpgsql as $g$
    declare v jsonb;
    begin
      v := public.create_order(gen_random_uuid(), 'Client Test', 'test@example.com', p_phone, 'pickup', null, null, null, p_items, '');
      return (select o.id from public.orders o where o.reference = v->>'reference');
    end $g$
  $f$;

  -- Fixtures
  insert into public.categories (name, slug, is_active) values ('Test annulation', 'test-annulation-' || substr(gen_random_uuid()::text, 1, 8), true) returning id into v_cat;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'A suivi', 'as-' || substr(gen_random_uuid()::text, 1, 8), 10000, true, 'tracked', 'available') returning id into p_track;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'A sur commande', 'ao-' || substr(gen_random_uuid()::text, 1, 8), 20000, true, 'on_demand', 'available') returning id into p_od;
  insert into public.products (category_id, name, slug, price_fcfa, is_published, inventory_mode, availability_status)
  values (v_cat, 'A stock perdu', 'an-' || substr(gen_random_uuid()::text, 1, 8), 10000, true, 'tracked', 'available') returning id into p_null;
  insert into public.product_inventory (product_id, stock_quantity) values (p_track, 5), (p_null, 5);

  -- ===== 1. Commande mixte (suivi x2 + sur commande x1) : stock 5 -> 3, puis annulation par un administrateur
  v_phone := v_phone + 1;
  v_order := pg_temp.mk_order(jsonb_build_array(jsonb_build_object('product_id', p_track, 'quantity', 2), jsonb_build_object('product_id', p_od, 'quantity', 1)), '07000100' || lpad(v_phone::text, 2, '0'));
  select stock_quantity into v_qty from public.product_inventory where product_id = p_track;
  v_n := v_n + 1; if v_qty <> 3 then v_fail := v_fail || E'\n1a: stock après commande attendu 3, obtenu ' || coalesce(v_qty::text, 'NULL'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'admin-test@example.com')::text, true);
  set local role authenticated;
  v_res := public.admin_set_order_status(v_order, 'cancelled');
  reset role;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_track;
  v_n := v_n + 1; if v_qty <> 5 then v_fail := v_fail || E'\n1b: stock après annulation attendu 5 (seul le suivi est restitué), obtenu ' || coalesce(v_qty::text, 'NULL'); end if;
  v_n := v_n + 1; if (v_res->>'stock_units_to_restore')::int <> 2 or (v_res->>'stock_units_restored')::int <> 2 then v_fail := v_fail || E'\n1c: unités attendues 2/2, obtenu ' || coalesce(v_res->>'stock_units_to_restore', 'NULL') || '/' || coalesce(v_res->>'stock_units_restored', 'NULL'); end if;
  v_n := v_n + 1; if exists (select 1 from public.product_inventory where product_id = p_od) then v_fail := v_fail || E'\n1d: une ligne de stock a été créée pour le produit sur commande'; end if;
  select count(*) into v_cnt from public.order_status_events where order_id = v_order and from_status = 'pending' and to_status = 'cancelled' and actor_id = v_admin and stock_units_to_restore = 2 and stock_units_restored = 2;
  v_n := v_n + 1; if v_cnt <> 1 then v_fail := v_fail || E'\n1e: ligne d''historique attendue (pending->cancelled, auteur, 2/2), trouvées ' || v_cnt; end if;

  -- ===== 2. Double annulation : refusée (INVALID_TRANSITION), stock et historique inchangés
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_set_order_status(v_order, 'cancelled');
    reset role;
    v_msg := 'ACCEPTÉE';
  exception when others then
    reset role;
    v_msg := sqlerrm;
  end;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_track;
  select count(*) into v_cnt from public.order_status_events where order_id = v_order;
  v_n := v_n + 1; if v_msg <> 'INVALID_TRANSITION' then v_fail := v_fail || E'\n2a: attendu INVALID_TRANSITION, obtenu ' || v_msg; end if;
  v_n := v_n + 1; if v_qty <> 5 then v_fail := v_fail || E'\n2b: stock après 2e tentative attendu 5, obtenu ' || coalesce(v_qty::text, 'NULL'); end if;
  v_n := v_n + 1; if v_cnt <> 1 then v_fail := v_fail || E'\n2c: historique attendu 1 ligne, obtenu ' || v_cnt; end if;

  -- ===== 3. Stock devenu NULL avant l'annulation : annulation acceptée, restitution impossible, écart enregistré, aucun stock inventé
  v_phone := v_phone + 1;
  v_order := pg_temp.mk_order(jsonb_build_array(jsonb_build_object('product_id', p_null, 'quantity', 1)), '07000100' || lpad(v_phone::text, 2, '0'));
  update public.product_inventory set stock_quantity = null where product_id = p_null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.admin_set_order_status(v_order, 'cancelled');
  reset role;
  select stock_quantity into v_qty from public.product_inventory where product_id = p_null;
  v_n := v_n + 1; if v_qty is not null then v_fail := v_fail || E'\n3a: le stock NULL ne doit pas être remplacé, obtenu ' || v_qty; end if;
  v_n := v_n + 1; if (v_res->>'stock_units_to_restore')::int <> 1 or (v_res->>'stock_units_restored')::int <> 0 then v_fail := v_fail || E'\n3b: unités attendues 1/0, obtenu ' || coalesce(v_res->>'stock_units_to_restore', 'NULL') || '/' || coalesce(v_res->>'stock_units_restored', 'NULL'); end if;
  select count(*) into v_cnt from public.order_status_events where order_id = v_order and stock_units_to_restore = 1 and stock_units_restored = 0;
  v_n := v_n + 1; if v_cnt <> 1 then v_fail := v_fail || E'\n3c: écart attendu dans l''historique, trouvées ' || v_cnt; end if;

  -- ===== 4. Changement de statut sans annulation : historisé, 0 unité
  v_phone := v_phone + 1;
  v_order := pg_temp.mk_order(jsonb_build_array(jsonb_build_object('product_id', p_od, 'quantity', 1)), '07000100' || lpad(v_phone::text, 2, '0'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.admin_set_order_status(v_order, 'confirmed');
  reset role;
  select count(*) into v_cnt from public.order_status_events where order_id = v_order and from_status = 'pending' and to_status = 'confirmed' and stock_units_to_restore = 0 and stock_units_restored = 0;
  v_n := v_n + 1; if v_cnt <> 1 then v_fail := v_fail || E'\n4: ligne pending->confirmed attendue (0/0), trouvées ' || v_cnt; end if;

  -- ===== 5. Annulation d'une commande 100 % « sur commande » : aucune restitution, message exact (0/0)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.admin_set_order_status(v_order, 'cancelled');
  reset role;
  v_n := v_n + 1; if (v_res->>'stock_units_to_restore')::int <> 0 or (v_res->>'stock_units_restored')::int <> 0 then v_fail := v_fail || E'\n5: unités attendues 0/0, obtenu ' || coalesce(v_res->>'stock_units_to_restore', 'NULL') || '/' || coalesce(v_res->>'stock_units_restored', 'NULL'); end if;

  -- ===== 6. Non-administrateur : refusé (FORBIDDEN), aucun historique
  v_phone := v_phone + 1;
  v_order := pg_temp.mk_order(jsonb_build_array(jsonb_build_object('product_id', p_od, 'quantity', 1)), '07000100' || lpad(v_phone::text, 2, '0'));
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_set_order_status(v_order, 'confirmed');
    reset role;
    v_msg := 'ACCEPTÉ';
  exception when others then
    reset role;
    v_msg := sqlerrm;
  end;
  select count(*) into v_cnt from public.order_status_events where order_id = v_order;
  v_n := v_n + 1; if v_msg <> 'FORBIDDEN' or v_cnt <> 0 then v_fail := v_fail || E'\n6: attendu FORBIDDEN et 0 ligne, obtenu ' || v_msg || ' / ' || v_cnt; end if;

  -- ===== 7. Historique immuable : modification et suppression refusées, même en propriétaire
  begin
    update public.order_status_events set to_status = 'pending' where order_id = v_order or true;
    v_msg := 'ACCEPTÉE';
  exception when others then v_msg := sqlerrm; end;
  v_n := v_n + 1; if v_msg <> 'ORDER_STATUS_HISTORY_IMMUTABLE' then v_fail := v_fail || E'\n7a: UPDATE attendu refusé, obtenu ' || v_msg; end if;
  begin
    delete from public.order_status_events;
    v_msg := 'ACCEPTÉE';
  exception when others then v_msg := sqlerrm; end;
  v_n := v_n + 1; if v_msg <> 'ORDER_STATUS_HISTORY_IMMUTABLE' then v_fail := v_fail || E'\n7b: DELETE attendu refusé, obtenu ' || v_msg; end if;

  -- ===== 8. Écriture directe par un administrateur dans l'historique : refusée (aucun droit d'insertion)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.order_status_events (order_id, from_status, to_status) values (v_order, 'pending', 'confirmed');
    reset role;
    v_msg := 'ACCEPTÉE';
  exception when others then
    reset role;
    v_msg := sqlerrm;
  end;
  v_n := v_n + 1; if v_msg = 'ACCEPTÉE' then v_fail := v_fail || E'\n8: l''insertion directe ne doit pas être permise'; end if;

  -- ===== 9. Mise à jour directe de orders.status par un administrateur : refusée (le seul chemin est la fonction)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.orders set status = 'cancelled' where id = v_order;
    get diagnostics v_cnt = row_count;
    reset role;
    v_msg := case when v_cnt = 0 then 'AUCUNE LIGNE' else 'ACCEPTÉE' end;
  exception when others then
    reset role;
    v_msg := sqlerrm;
  end;
  v_n := v_n + 1; if v_msg = 'ACCEPTÉE' then v_fail := v_fail || E'\n9: la mise à jour directe du statut ne doit pas être permise'; end if;

  if v_fail = '' then
    raise exception E'RAPPORT : %/% contrôles réussis (tout est annulé)', v_n, v_n;
  else
    raise exception E'RAPPORT : ÉCHECS (tout est annulé) :%', v_fail;
  end if;
end $$;
