# WeNeed Companion — interface mobile alpha

Prototype d'interface privée pour consultation **en lecture seule** des commandes Odoo GTA / Trim Rocket et préparation du rapprochement des commissions.

## Publication GitHub Pages

Dans **Settings → Pages**, choisir **Deploy from a branch**, puis `main` et `/(root)`, puis **Save**.

Une fois le site publié : https://bradrien.github.io/weneed-companion-u/

## Configuration

- Supabase Auth : connexion propriétaire par e-mail et mot de passe.
- Fonction `companion-profile` : vérifie la session et l'autorisation propriétaire.
- Fonction `commission-review` : lecture Odoo et revue des commandes GTA/TR, sans écriture.
- `assets/config.js` : URL de projet et clé **publishable** Supabase uniquement (publique par conception).
- Les secrets Odoo ne figurent **jamais** dans ce dépôt.

## Limites connues

- Les commissions ne sont **pas calculées** tant que les règles Kino n'ont pas été vérifiées.
- L'accès aux commandes doit être validé en condition réelle depuis Safari iPhone.
- Aucun import automatique ni transcription audio ne sont activés.
- GitHub Pages héberge des fichiers **publics** ; seul le contenu de l'application est protégé par l'authentification et les autorisations vérifiées côté serveur.
- Le dépôt historique `cockpit-weneed` est indépendant et ne doit pas être modifié pour ce projet.
