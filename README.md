# WeNeed Companion — V1.2, rapprochement Kino

Application commerciale **en lecture seule** pour les commandes Odoo de GTA et Trim Rocket, avec une vérification des SKU contre le catalogue Kino.

Adresse hébergée : https://bradrien.github.io/weneed-companion-u/

## Fonctionnement

- Connexion par Supabase Auth et contrôle propriétaire côté serveur.
- Commandes Odoo obtenues via `commission-catalog-review` (Supabase Edge Function, JWT obligatoire).
- Correspondance des lignes éligibles par **société + SKU normalisé (casse/espaces externes uniquement)**.
- Les références non trouvées, manquantes ou ambiguës sont signalées, sans suggestion automatique hasardeuse.
- Les échantillons, livraisons, commandes non confirmées, et lignes gratuites sont distingués.
- Le catalogue est une **capture horodatée**, pas un inventaire en direct.
- Les coûts et prix catalogue ne sont **pas** des marges ou des commissions.
- Aucun montant de commission n'est calculé tant que la logique du simulateur Kino (notamment SPIFF) n'a pas été validée.
- Si le service de rapprochement est indisponible, l'interface utilise le rapport Odoo historique `commission-review` et signale que Kino est indisponible.

## Données et sécurité

- Le dépôt GitHub Pages est **public** ; ne jamais y ajouter de secrets, données commerciales ou identifiants.
- L'URL et la clé Supabase `sb_publishable_*` exposées dans `assets/config.js` sont publiques par conception.
- Les secrets Odoo restent dans les variables de la fonction Supabase.
- Tables privées `kino_catalog_snapshots`, `kino_catalog_products` : RLS activée, pas de `SELECT` pour `anon`/`authenticated` ; lecture par la fonction serveur après authentification propriétaire.
- Le rapprochement est transitoire : les commandes client ne sont pas copiées en base.
- L'application conserve les jetons Supabase en `sessionStorage` et nettoie la session à la déconnexion. Ne pas utiliser sur un poste partagé.
- `commission-catalog-review` et `commission-review` sont en lecture seule.

## Développement et version candidate

Node 20 ou plus récent, sans dépendances à installer :

```sh
npm test
npm run check:bridge
```

Le dossier `kino-bridge/` contient une version **0.7.0 candidate**, dérivée de la version 0.5.0 installée. L'archive 0.6 n'a pas pu être récupérée ; aucune équivalence avec cette version n'est présumée. Voir `kino-bridge/INSTALLATION.txt` pour la validation et le retour arrière.

La recherche filtre les suggestions par SKU et société, ignore les filtres du catalogue, protège une saisie utilisateur concurrente et permet de choisir le SKU testé. Les tests utilisent un DOM simulé : ils ne remplacent pas une validation Chrome/React. Le bridge n'automatise pas la sélection d'un produit ni les simulations de vente.

L'interface invalide les réponses de rapports antérieurs lors d'un changement de mois ou d'une déconnexion. Les commissions restent non calculées.

## Vérifications

- 1 385/1 385 produits Kino importés dans la base privée : 571 GTA, 814 TR.
- Aucun doublon sur le couple société + SKU, 220 SKU présents chez les deux sociétés.
- 365 coûts et 150 prix catalogue à zéro : **à examiner** (pas à corriger automatiquement).
- Tests syntaxiques Node et tests du modèle côté client réussis.
- **Connexion réelle du nouvel écran à l'API de rapprochement non encore testée avec le compte utilisateur** : validation à faire sur Safari/Chrome.

## Prochaine validation

1. Ouvrir https://bradrien.github.io/weneed-companion-u/ et recharger sans cache (ou naviguer en fenêtre privée).
2. Se connecter à son compte propriétaire.
3. Choisir septembre 2026 et cliquer sur ↻.
4. Sur « Commissions », vérifier le nombre de SKU retrouvés / non retrouvés.
5. Sur « Commandes », ouvrir une commande confirmée et vérifier les coûts/prix Kino sur ses lignes.
6. S'assurer que les commissions restent « À vérifier ».

Si un message d'erreur apparaît, conserver le texte pour diagnostic. Les tests réels nécessitent le JWT de la session utilisateur, non communicable dans le chat.


## CRM mobile — branche de validation

Cette branche ajoute, en **lecture seule et derrière Supabase Auth**, un onglet « Clients » :
recherche de boutiques, fiches commerciales (contacts, mémoire, actions à suivre, activité récente) et panneau CRM indépendant d'Odoo sur l'accueil.

Les données CRM sont récupérées depuis `companion-api` avec le jeton de la session propriétaire et ne sont pas conservées dans `localStorage`. Les valeurs métier sont affichées comme texte, sans injection HTML. L'API serveur vérifie l'accès avant d'utiliser les fonctions SQL privées.

Les contrôles automatiques comprennent les scénarios de déconnexion pendant le renouvellement de session, les données CRM incohérentes, les références des éléments HTML et les gardes de commissions. Exécuter `npm run check:app` en plus de `npm test` et `npm run check:bridge`.

**Ce n'est pas encore la version GitHub Pages en production.** L'interface CRM nécessite une validation sur Safari iPhone avec le compte propriétaire avant fusion. L'extension Kino 0.7 reste également candidate.

[Cartographie de l'architecture et plan de validation](docs/ARCHITECTURE.md).
