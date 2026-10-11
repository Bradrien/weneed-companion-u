# D31 — Calcul vérifiable et export mensuel

Le bilan mensuel affiche une répartition GTA/TR des devis potentiels et des commandes prévisionnelles. Les filtres société et recherche portent sur la même sélection dans le bilan, les rapprochements et l'export.

Chaque ligne estimée peut ouvrir sa décomposition : prix net après remise, coût Kino ramené à l'unité Odoo, coefficient de coût, marge de calcul, taux et commission arrondie au centime. Le même module pur est utilisé par le serveur, le scénario confirmé et le détail des commandes. Le navigateur rejoue le calcul et refuse les incohérences ; les sommes de commande restent en centimes.

Le contrôle de provenance montre la date du catalogue, son ancienneté à la lecture et la chronologie des documents. Une capture récente ne constitue pas une preuve du coût à la date de vente. Le SPIFF, les exclusions contractuelles, les avoirs et le paiement restent non validés.

L'export CSV contient toutes les lignes Odoo sélectionnées, leurs états et leurs diagnostics. Il conserve les signes et les coûts nuls, distingue une estimation zéro d'une estimation manquante et laisse vides les commissions suspendues. Les codes candidats restent séparés du SKU officiel. Les textes sont échappés pour les tableurs. Une lecture échouée ou non revérifiée désactive l'export enrichi.

Validation : contrôles synthétiques des formules, remises, arrondis, replay, provenance, CSV, filtres, valeurs signées et coûts manquants ; parcours mobile avec téléchargement réel et échec d'actualisation. Les données commerciales et les identifiants ne sont pas publiés.
