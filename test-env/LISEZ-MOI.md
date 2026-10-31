# Environnement de test des commandes — Meritt Home

Objectif : tester de VRAIES commandes (création, stock, statuts, annulation, idempotence) sans toucher à la production
(`jvmvsaiduralhezrjeyg`).

## État constaté
- Un seul projet Supabase existe pour ce compte (organisation « badrisignature », 1 projet : la production).
- **Aucun projet de test n'existe.** Rien n'a été créé. Ces fichiers sont prêts, mais rien n'a été exécuté sur Supabase.

## Étape 1 — Créer le projet de test (action de votre part, aucun coût si vous restez sur l'offre gratuite)
1. Supabase > New project, dans votre organisation, nom `meritt-home-test`. **Choisissez l'offre gratuite** et ne souscrivez à rien de payant.
   Vérifiez dans le tableau de bord que l'offre gratuite autorise un second projet ; sinon n'allez pas plus loin et dites-le-moi.
2. Authentication > Users > Add user : créez un compte `admin-test@…` avec un mot de passe de TEST (différent de celui de la production).
3. Project Settings > API : notez l'URL du projet et la clé **publishable** (anon). N'utilisez jamais la clé service_role.

## Étape 2 — Préparer la base de test (éditeur SQL du projet de TEST, dans cet ordre)
1. `01-schema-base.sql` : schéma identique à la production avant migration (refuse de s'exécuter si des tables existent déjà).
2. `../migration-commandes.sql` : PARTIE 1 seulement (la migration réelle).
3. `03-donnees-test.sql` : après avoir remplacé `REMPLACER_PAR_EMAIL_ADMIN_TEST` par l'e-mail du compte admin de test.
   Il crée une catégorie, un produit à 25 000 FCFA, un stock de 5, la zone « Zone Test » à 1 500 FCFA et une adresse de retrait fictive.
Avant de lancer chaque script, vérifiez que l'URL de l'éditeur contient la référence du projet de TEST, pas `jvmvsaiduralhezrjeyg`.

## Étape 3 — Lancer l'application sur le projet de test (port 3001, sans modifier `.env.local`)
Dans un terminal PowerShell, à la racine du projet :

    $env:NEXT_PUBLIC_SUPABASE_URL = "https://<ref-test>.supabase.co"
    $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "<clé publishable de TEST>"
    npx next dev -p 3001

Les variables d'environnement du terminal l'emportent sur `.env.local`. Le serveur habituel (port 3000) reste sur la production.

## Étape 4 — Lancer le test de bout en bout (même terminal ou un autre)

    $env:TEST_SUPABASE_URL = "https://<ref-test>.supabase.co"
    $env:TEST_SUPABASE_KEY = "<clé publishable de TEST>"
    $env:TEST_ADMIN_EMAIL = "<e-mail admin de TEST>"
    $env:TEST_ADMIN_PASSWORD = "<mot de passe admin de TEST>"
    node test-env/e2e-commande.mjs

Le script refuse de démarrer si l'URL contient la référence de la production, bloque toute requête vers un autre projet Supabase
et n'utilise aucune clé service_role.

## Ce que le test vérifie
Commande en livraison (référence PostgreSQL, lignes, total 26 500, stock 5 → 4), commande en retrait (frais 0, adresse de test, stock → 3),
rejeu idempotent, affichage dans `/admin/commandes`, transitions autorisées pour chaque mode, annulation avec restitution unique du stock (3 → 4),
seconde annulation refusée, paiement toujours « pending ».
