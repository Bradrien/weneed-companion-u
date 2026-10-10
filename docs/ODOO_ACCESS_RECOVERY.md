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

## Nouvel indice — clé potentiellement valable un jour

- L'utilisateur confirme le 10 octobre que la clé API renseignée dans Supabase était déjà celle de la configuration initiale ; **remplacer le secret par la même chaîne n'apporterait aucune correction**.
- Les journaux de `odoo-read` affichent **36 GET 200 le 9 octobre 2026 entre 12:30 et 14:00 UTC**. Le 10 octobre, `odoo-read` v11 renvoie `odoo_credentials_rejected` après résolution des requêtes CORS 403.
- D'après la documentation officielle Odoo 19, la durée de validité d'une clé est choisie lors de sa génération ; **une durée d'un jour est explicitement recommandée pour l'usage interactif** et la limite standard est de trois mois. **Si une durée d'un jour a été choisie la veille**, l'expiration expliquerait précisément la chronologie observée, mais n'est pas encore démontrée.
- **Priorité :** vérifier dans Odoo **Mon profil → Sécurité du compte → Clés API** la date d'expiration de la clé utilisée par Companion avant de modifier des secrets ou les noms de base/login. Si expirée, créer une nouvelle clé dédiée pour le même utilisateur avec une validité adaptée à l'intégration et prévoir sa rotation, puis l'enregistrer uniquement dans le secret `ODOO_API_KEY` via Supabase Dashboard.
- Ne pas publier ou coller la nouvelle clé dans ChatGPT, GitHub ou la documentation.

Référence : https://www.odoo.com/documentation/19.0/developer/reference/external_api.html#api-keys
