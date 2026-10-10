# Récupération de l'accès Odoo — WeNeed Companion

## Diagnostic confirmé (10 octobre 2026)

Le compte propriétaire Supabase fonctionne. La préversion Safari communique avec `odoo-read` v11 et le test `GET ?resource=ping` renvoie **HTTP 502 / `odoo_credentials_rejected`**.

Le code serveur appelle Odoo `common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})`. La fonction refuse ici une réponse Odoo sans UID positif. Cela implique qu'une combinaison base / compte / clé ne permet pas à Odoo de reconnaître l'utilisateur. Le contrôle séparé `ODOO_UID_PIN` n'a pas encore été atteint : **ne pas supprimer/modifier ce contrôle comme première solution.**

Historique : `odoo-read` a répondu avec succès le 9 octobre. La panne est constatée le 10 octobre, après résolution d'un problème CORS indépendant. Une clé API révoquée/expirée est une piste, non une conclusion établie.

## Réparation sécurisée — propriétaire / administrateur

1. Identifier le compte utilisateur dont le **login Odoo** figure dans la configuration sécurisée `ODOO_USERNAME`. Ce n'est pas nécessairement l'adresse e-mail de connexion à Companion. Ne pas copier ce login depuis un exemple non vérifié.
2. Dans Odoo, avec **ce même compte**, ouvrir *Préférences / Mon profil → Sécurité du compte → Clés API*. Examiner si la clé dédiée à Companion est encore active et sa date d'expiration, ainsi que tout changement de compte/droits. Les clés existantes ne sont pas récupérables en clair.
3. Dans Supabase → projet WeNeed Companion → **Edge Functions → Secrets**, vérifier **sans transmettre de valeur au chat** la présence des paramètres `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` et `ODOO_URL`. Ne modifier ni `ODOO_UID_PIN` ni `SUPABASE_*` par tâtonnement.
4. Si la clé est invalide ou inaccessible, générer une clé API Odoo **pour le même utilisateur**, nommée « WeNeed Companion » ; copier sa valeur dans le secret de production `ODOO_API_KEY` **directement dans le Dashboard Supabase**, jamais dans GitHub, le chat ou un screenshot. Conserver l'ancienne clé jusqu'à validation de la nouvelle connexion, lorsqu'elle est encore active.
5. Revenir sur https://bradrien.github.io/weneed-companion-u/validation-v12/ et lancer *Réglages → Vérifier l'accès Odoo en lecture seule*. Attendre **« Accès lecture validé »** avant de relancer le rapport septembre.
6. Si le diagnostic devient `odoo_uid_pin_mismatch`, faire vérifier le compte choisi avant toute modification du contrôle d'identité. Ne pas désactiver le pin comme contournement.
7. Après validation, retirer les anciennes clés inutilisées suivant la politique Odoo et les dépendances des autres systèmes.

Les changements de secrets des Edge Functions Supabase sont appliqués sans redéploiement de leur code.

Sources officielles :
- https://www.odoo.com/documentation/19.0/developer/reference/external_rpc_api.html
- https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
- https://supabase.com/docs/guides/functions/secrets

## Invariants

- Aucune donnée Odoo écrite par Companion.
- Les fonctions restent limitées aux JWT des propriétaires.
- Aucune valeur d'API key dans le dépôt, les fichiers de log ou les messages.
- Ne pas confondre mot de passe de Companion et API key Odoo.

## Correction du diagnostic après confirmation du propriétaire (10 octobre 2026)

Le propriétaire a confirmé que **la clé Odoo a été créée avec une durée de validité de trois mois**. La piste d'une durée initiale de 24 heures est donc **écartée**. Le passage des GET 200 du 9 octobre à `odoo_credentials_rejected` le 10 octobre reste établi, mais ne prouve ni une expiration, ni une révocation, ni un changement de configuration.

La connexion serveur repose sur `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` et le compte propriétaire Odoo. La configuration initiale indiquait l'instance `https://weneedweed.odoo.com`, une base `weneedweed` et l'utilisateur `ah@weneedweed.eu` ; ce sont des **valeurs historiques attendues**, non la preuve des secrets actuellement chargés.

Ordre des vérifications sans rotation inutile :

1. Confirmer dans Odoo, sous l'utilisateur qui a **créé la clé**, que cette clé existe toujours, n'est pas révoquée, et que l'utilisateur est actif. Vérifier le **login Odoo** du compte lié (le login peut différer de l'adresse de contact).
2. Comparer la base et le login de la configuration Supabase avec les valeurs de référence, sans copier ni exposer la clé. Le connecteur Supabase disponible ne permet pas de lire ni de modifier les secrets d'environnement.
3. Vérifier si les paramètres ont changé depuis les authentifications du 9 octobre. Éviter de conclure à une expiration sur la seule chronologie.
4. Si toutes ces vérifications sont correctes, créer une **nouvelle clé pour le même compte** et la mettre à jour uniquement dans `ODOO_API_KEY` ; tester `odoo-read?resource=ping` avant de désactiver l'ancienne.

## Ancien Cockpit vs Companion : cause potentielle isolée (10 octobre 2026)

Le propriétaire confirme que **l'ancien Cockpit continue à actualiser les commandes Odoo aujourd'hui**. Le code de référence a été retrouvé dans `Bradrien/cockpit-weneed` (`app.py`) :

- Ancien Cockpit Flask : `https://weneedweed.odoo.com`, base `weneedweed`, UID Odoo numérique connu, appel direct `object.execute_kw` avec un **mot de passe intégré dans le code historique**. Il ne passe pas par `common.authenticate`. Le bouton de rafraîchissement déclenche un chargement asynchrone en serveur. **Ne pas recopier l'ancien mot de passe dans ce document ou dans Companion.**
- Companion : lit `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`, `ODOO_UID_PIN` dans les secrets Edge Functions, puis appelle `common.authenticate`, actuellement refusé.
- La différence de méthode d'authentification explique pourquoi le succès de l'ancien outil **ne prouve pas** la validité de la clé API Companion.
- `odoo-read` v12 ajoute l'endpoint propriétaire `credential_probe` : appel `sale.order.search_read` avec UID **uniquement issu du secret `ODOO_UID_PIN`** et clé **uniquement issue de `ODOO_API_KEY`**. Aucune donnée Odoo n'est renvoyée ; seules la catégorie de résultat et la présence d'un droit de lecture sont observables.
- Si ce test réussit tandis que `common.authenticate` échoue : investiguer prioritairement le **login** `ODOO_USERNAME`, sans remplacer la clé.
- S'il échoue aussi : vérifier clé API, base de données, UID et droits de lecture ; l'échec n'identifie pas à lui seul une clé invalide.
- Si `odoo_uid_pin_not_configured` : configurer l'UID attendu sans contourner la validation, dans les secrets Supabase, après vérification de l'identité.
- L'ancien dépôt contient un identifiant sensible en clair. Prévoir rotation et retrait de ce secret de l'historique du dépôt, avec vérification de toutes les dépendances avant suppression ; le vieux script désactive également la validation du certificat SSL, ce qui exige une correction séparée.

Préversion D3 : https://bradrien.github.io/weneed-companion-u/validation-v12/?build=D3-20261010
