# WeNeed Companion — Stratégie D19

## Périmètre et provenance
La préversion D19 ajoute un onglet Stratégie avec indicateurs de portefeuille, diagnostics client et simulations de remises. Aucun prix, commande ou commission n’est modifié dans Odoo.

- Sources: ventes Odoo en lecture seule (filtrées par commercial et période de 365 jours), liaisons CRM–Odoo explicitement vérifiées, activité WhatsApp déjà approuvée, mémoires CRM existantes.
- Couverture lors de la préparation: 131 fiches clients CRM, 86 reliées à des archives WhatsApp textuelles, 2 liaisons Odoo actives. Les données évoluent.
- Les clients non reliés à Odoo ont un chiffre d’affaires « inconnu », pas zéro. Les partenaires Odoo non reliés sont isolés et présentés pour validation d'identité.
- Les rapprochements proposés par nom normalisé strictement identique ne valent jamais confirmation.

## Définitions de calcul
- CA HT attribué: sommes amount_untaxed positives en EUR, commandes sale/done, partenaire Odoo vérifié, période choisie.
- Panier moyen: CA HT attribué / commandes positives confirmées.
- Rythme d’achat: médiane des intervalles entre dates de commande positives distinctes (au moins deux dates nécessaires).
- Part TR / GTA: partage du seul CA Odoo positif attribué, non partage de l’ensemble des ventes.
- Tendance: derniers 90 jours versus 90 jours précédents; ne corrige pas saisonnalité, stock ni facturation.
- Volume physique et marge réelle: indisponibles sans rapprochement des lignes SKU, unités de mesure, coût, frais et éventuels avoirs.
- Motivation: non estimée depuis le volume des messages. Activité WhatsApp et mémoire CRM servent de signaux contextuels non concluants.

## Décisions commerciales
- Reconquête si cadence médiane et âge de dernière commande indiquent un ralentissement; toujours diagnostiquer la cause avant toute remise.
- Développement du mix: tester une gamme complémentaire quand GTA ou TR représente plus de 88 % du CA attribué et qu’il existe plusieurs commandes.
- Comparer CA sur deux fenêtres de 90 jours, et signaler les baisses; l'absence de vente Odoo ne qualifie pas un client de perdu.
- Seconde commande à déclencher lorsqu’un seul jour d’achat est observé.
- Remises conditionnelles possibles si l’élasticité est plausible et que la marge contributive progresse.

## Simulateur de remise
Soit P le prix unitaire initial, C le coût variable unitaire comparable, P2 le nouveau prix, Q le volume de référence et Q2 le volume espéré.
Marge contributive initiale = (P - C) × Q. Après = (P2 - C) × Q2.
Volume nécessaire pour protéger la marge = ((P - C) × Q) / (P2 - C), avec P>C et P2>C.
Comparateur de scénarios de rabais 2 %, 4 %, 6 %, 8 %. La simulation n’inclut pas commissions, TVA, livraison, coûts fixes ou avoirs. Ne pas l’employer comme promesse de gain.

## Fiabilité et sécurité
- Edge Function privée strategy-portfolio: JWT propriétaire, ACL owner, allowlist origine, identifiants Odoo secrets côté serveur.
- Relecture des statuts Odoo juste avant le calcul; refus des écarts de statut.
- Fenêtre 365 jours et garde-fou maximum 1 200 commandes. Si Odoo échoue ou dépasse la limite, statut « indisponible » et aucune valeur n’est inventée.
- Préversion indépendante de la branche principale; aucun écrasement des anciennes mémoires ni rapprochement CRM silencieux.

## Chantiers suivants
1. Confirmer les correspondances clients ↔ partenaires Odoo, en priorité les plus forts volumes non attribués.
2. Consolider lignes de vente, SKU, UOM, catégories produit, remises, coûts Kino et frais variables.
3. Séparer commandes, livraisons, factures, encaissements et avoirs; intégrer les retours.
4. Ajouter des résumés qualitatifs sourcés des textes WhatsApp/Gmail pour comprendre les objections, souhaits, motivations et engagements.
5. Tester des paliers de prix conditionnels au volume réellement mesuré avant décision commerciale.