-- MERITT HOME — PROJET DE TEST UNIQUEMENT (kmjoyioeanjrvohmfash). LECTURE SEULE : aucune ecriture.
-- Verifiez que l'URL de l'editeur SQL contient « kmjoyioeanjrvohmfash » avant d'executer.
-- Colle le resultat dans la conversation : ok = true partout pour les lignes « prerequis ».
select 'prerequis : products'                       as controle, to_regclass('public.products') is not null as ok
union all select 'prerequis : categories',            to_regclass('public.categories') is not null
union all select 'prerequis : product_inventory',     to_regclass('public.product_inventory') is not null
union all select 'prerequis : order_items',           to_regclass('public.order_items') is not null
union all select 'prerequis : order_settings.untracked_stock_policy', exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_settings' and column_name='untracked_stock_policy')
union all select 'prerequis : create_order (10 args)', exists (select 1 from pg_proc where proname='create_order' and pronamespace='public'::regnamespace and pronargs=10)
union all select 'prerequis : order_summary',         exists (select 1 from pg_proc where proname='order_summary' and pronamespace='public'::regnamespace)
union all select 'prerequis : is_admin()',            exists (select 1 from pg_proc where proname='is_admin' and pronamespace='public'::regnamespace)
union all select 'prerequis : set_updated_at()',      exists (select 1 from pg_proc where proname='set_updated_at' and pronamespace='public'::regnamespace)
union all select 'etat : products.inventory_mode (attendu false avant migration)',      exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='inventory_mode')
union all select 'etat : products.availability_status (attendu false avant)',            exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='availability_status')
union all select 'etat : products.lead_time (attendu false avant)',                      exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='lead_time')
union all select 'etat : get_catalogue_availability (attendu false avant)',              exists (select 1 from pg_proc where proname='get_catalogue_availability' and pronamespace='public'::regnamespace)
union all select 'etat : site_banners (attendu false avant)',                            to_regclass('public.site_banners') is not null;

-- Information : produits publies et leur ligne de stock (NULL = stock non renseigne -> STOCK_UNTRACKED a la commande).
select p.id, p.name, p.is_published, (i.product_id is not null) as has_inv_row, i.stock_quantity,
       (select untracked_stock_policy from public.order_settings limit 1) as policy
from public.products p left join public.product_inventory i on i.product_id = p.id
order by p.name;
