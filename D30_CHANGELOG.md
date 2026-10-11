# D30 — Cohérence des calculs Kino

Le bilan mensuel, le scénario confirmé et le détail des lignes de commande utilisent désormais la même réconciliation gramme/sachet et le même arrondi au centime par ligne. Les anciennes variantes D24 sont conservées pour leurs tests historiques ; la préversion D30 charge les nouveaux modules.

Le filtre d'exclusion du pipeline examine l'identité du produit et son SKU. Une mention d'échantillon ou de transport dans les notes d'une ligne vendue n'exclut plus le produit. Les identités explicites d'échantillons et de livraison restent signalées comme hors scénario selon la politique provisoire.

La révision serveur 6 conserve les contrôles propriétaire, les lectures Odoo répétées, les montants signés et la suspension des unités ambiguës. Les SKU absents, coûts nuls, coûts historiques, SPIFF, avoirs et règles de paiement restent à vérifier. Aucun montant n'est déclaré acquis ou payable.

Validation : tests de conversion gramme/sachet, cohérence entre les trois vues, arrondis par ligne, notes de facture, exclusions explicites, unités ambiguës et contrôle mobile avec données synthétiques. Les données commerciales réelles et les identifiants ne sont pas publiés dans ce dépôt.
