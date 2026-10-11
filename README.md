# WeNeed Companion

Companion commercial avec commandes et stocks Odoo en lecture seule, authentification Supabase et accès propriétaire vérifié côté serveur.

La préversion en cours est disponible sur [validation-v12](https://bradrien.github.io/weneed-companion-u/validation-v12/). La page principale conserve sa version antérieure.

## Commissions — D31

- Bilan par mois, société et recherche, avec séparation des devis non confirmés et des commandes confirmées/facturées.
- Rapprochement Kino strict par société et SKU. Un code dans un libellé reste un candidat si le champ SKU Odoo est vide.
- Réconciliation conservatrice gramme/sachet ; les unités ambiguës, coûts nuls et références absentes restent non estimés.
- Décomposition par ligne et calcul commun au serveur, au scénario confirmé et au détail des commandes ; arrondi au centime par ligne.
- Provenance horodatée du catalogue et seconde lecture bornée des prix, remises, montants et états Odoo.
- Export CSV de la sélection avec diagnostics, valeurs signées, protection des textes et commissions suspendues laissées vides.

Les simulations utilisent une capture du catalogue actuel et restent provisoires. Les coûts historiques, le SPIFF, les exclusions contractuelles, les avoirs et les paiements ne sont pas validés. Le statut facturé Odoo ne constitue pas une preuve de règlement. Aucun montant n'est déclaré acquis ou payable.

## Sécurité

Le dépôt GitHub Pages est public : aucun secret, document client ou jeu de données commerciales ne doit y être ajouté. La clé Supabase publiable du navigateur est publique par conception ; les secrets Odoo et les clés de service restent côté serveur. Les tables catalogue sont privées et ne sont lues qu'après contrôle propriétaire. Aucune commande Odoo n'est modifiée.

## Vérification

Le workflow GitHub vérifie la syntaxe, les modèles et fonctions avec des données synthétiques, les contrôles SQL isolés et les parcours Chromium sur écran mobile. Les validations réelles des données se font par les API authentifiées, sans publier leurs réponses ni leurs jetons.

Les changements récents sont décrits dans [D30_CHANGELOG.md](D30_CHANGELOG.md) et [D31_CHANGELOG.md](D31_CHANGELOG.md).
