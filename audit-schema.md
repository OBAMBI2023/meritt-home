# Audit du schéma — Meritt Home (projet Supabase `jvmvsaiduralhezrjeyg`)

Relevé le 29/10/2026 par des requêtes SELECT dans l'éditeur SQL. Aucune écriture.
Le projet s'affiche dans le tableau de bord sous le nom « Badri signature » (organisation `badrisignature`) ; la référence correspond à celle de `.env.local`.

## Volumétrie
orders=0 · order_items=0 · products=1 (1 publié) · product_inventory=0 · categories=1 · admin_users=1 · profiles=0

## Tables (public)
- **orders** : id uuid PK; reference text NOT NULL UNIQUE default `MH-<année>-<nextval(order_reference_seq) sur 6 chiffres>`; customer_id uuid → auth.users ON DELETE SET NULL; customer_name text NOT NULL; customer_email text NOT NULL; customer_phone text NOT NULL; delivery_address text NOT NULL; delivery_commune text NOT NULL; customer_notes text; subtotal_fcfa int4 NOT NULL; delivery_fee_fcfa int4 NOT NULL default 0; total_fcfa int4 NOT NULL; status text NOT NULL default 'pending'; payment_method text NOT NULL default 'cash_on_delivery'; payment_status text NOT NULL default 'unpaid'; created_at, updated_at.
  - CHECK status ∈ {pending, confirmed, preparing, shipped, delivered, cancelled}
  - CHECK payment_method = 'cash_on_delivery' (seule valeur permise)
  - CHECK payment_status ∈ {unpaid, pending, paid, failed, refunded}
  - CHECK total_fcfa = subtotal_fcfa + delivery_fee_fcfa ; montants ≥ 0
  - Index : pkey, reference unique, customer_id, created_at desc
- **order_items** : id, order_id → orders ON DELETE RESTRICT, product_id → products ON DELETE SET NULL (nullable), product_name text NOT NULL, unit_price_fcfa, quantity (1..10), line_total_fcfa (= unit × quantité), created_at.
- **products** : id, category_id uuid **NOT NULL** → categories ON DELETE RESTRICT, name, slug (unique, regex), description, price_fcfa ≥ 0, image_urls text[] NOT NULL default '{}', is_published bool default false, created_at, updated_at.
- **product_inventory** : product_id PK → products ON DELETE CASCADE, stock_quantity int4 **NULLable** (CHECK NULL ou ≥ 0), updated_at.
- **categories**, **profiles** (id → auth.users), **admin_users** (user_id → auth.users).

## Fonctions et déclencheurs
- `is_admin()` : SECURITY DEFINER, `search_path=''`, exécutable par `authenticated` uniquement (pas `anon`).
- `set_updated_at()` : déclencheur BEFORE UPDATE sur categories, products, product_inventory, profiles, orders.
- Aucune fonction de création de commande, aucune fonction de stock, aucun déclencheur sur le stock.

## RLS (activé et non forcé sur toutes les tables)
- orders : SELECT admin ; **SELECT clients (customer_id = auth.uid())** ; UPDATE admin. **Aucune politique INSERT.**
- order_items : SELECT admin ; **SELECT clients via orders.customer_id**. Aucune politique INSERT.
- products : lecture publique si publié ET catégorie active ; ALL admin.
- categories : lecture publique si active ; ALL admin.
- product_inventory : ALL admin uniquement (aucune lecture publique).
- profiles / admin_users : lecture par soi-même ou admin ; profiles INSERT/UPDATE par soi-même.
- storage.objects (bucket `meritt-product-images`) : INSERT/UPDATE/DELETE réservés aux admins.

## Droits de table (anon / authenticated)
- anon : SELECT sur products et categories seulement.
- authenticated : orders et order_items **SELECT seulement** (pas d'INSERT ni d'UPDATE) ; products, categories (écriture), product_inventory (écriture), profiles (INSERT/SELECT/UPDATE), admin_users SELECT.
- Conséquence : la politique « Admins update order status » est aujourd'hui sans effet (aucun droit UPDATE sur orders).

## Constats clés pour le workflow de commande
1. Personne ne peut créer de commande : ni droit INSERT, ni politique INSERT, ni fonction.
2. `customer_email`, `delivery_address`, `delivery_commune` sont NOT NULL : incompatibles avec le retrait sur place et avec un e-mail facultatif.
3. `payment_method` n'accepte que `cash_on_delivery`.
4. Statuts existants : pas de `ready_for_pickup` ; `shipped` ≈ « en livraison », `delivered` ≈ « terminée ».
5. Stock : `product_inventory` est vide ; `stock_quantity` peut être NULL ; aucun mécanisme de décrément, donc aucun verrou ni risque de concurrence géré aujourd'hui.
6. Il n'existe ni grille de frais par commune, ni paramètre de commande, ni clé d'idempotence, ni limitation par téléphone.
7. `Customers read own orders` / `Customers read own order items` permettent à un client connecté de lire ses commandes en direct.
