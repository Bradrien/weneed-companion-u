# Kino Commission — moteur de simulation navigateur (extraction 10/10/2026)

## Portée et statut

La source de référence est un fichier JavaScript construit et minifié servi au navigateur Chrome connecté au calculateur Kino, fourni par le propriétaire du compte. Les fonctions de simulation `IT` (taux) et `FT` (ligne) ont été identifiées dans le bundle. Le code original n'est **pas** copié dans ce dépôt. Une réimplémentation indépendante figure dans `assets/kino-simulator.mjs`, testée dans `tests/kino-simulator.test.mjs`.

**Important :** ce moteur reproduit le SIMULATEUR côté navigateur. La gestion effective des commandes Odoo et des commissions par vendeur dans Kino utilise au moins deux fonctions Base44 **côté serveur** : `importOdooSales` et `recalcBatch`, appelées depuis le navigateur. Leurs implémentations ne sont **pas** contenues dans l'extraction et n'ont pas été validées. Ne pas assimiler une simulation à une créance ou à un montant acquis.

## Formules de simulation

Pour chaque ligne avec un produit du catalogue et un prix de vente / unité :

- Catégorie A : coût corrigé = coût Kino × **1,25**.
- Catégorie B : coût corrigé = coût Kino × **1,15**.
- Marge unitaire = prix saisi − coût corrigé.
- Marge totale = marge unitaire × quantité.
- Ratio de marge = marge unitaire / **coût Kino initial** (pas le coût corrigé). Si coût initial nul et marge unitaire positive, Kino attribue conventionnellement le ratio 999. Si les deux sont non positifs, ratio 0.
- Commission = max(0, marge totale) × taux progressif. Si marge totale n'est pas positive, le taux appliqué est zéro.
- Les montants sont conservés en précision décimale native du JavaScript ; pas d'arrondi intermédiaire dans l'extraction. L'affichage en euros utilise deux décimales.

**Catégorie A, ratio r :**

| Ratio r | Taux |
|---|---|
| r ≤ 0 | 20 % (mais commission = 0 si marge ≤ 0) |
| 0 < r ≤ 0,15 | 20 % + (r / 0,15) × 3,21 points |
| 0,15 < r < 0,80 | 23,21 % + ((r − 0,15) / 0,65) × 6,79 points |
| r ≥ 0,80 | 30 % |

**Catégorie B, ratio r :**

| Ratio r | Taux |
|---|---|
| r ≤ 0 | 22,254 % (mais commission = 0 si marge ≤ 0) |
| 0 < r < 1 | 22,254 % + r × 7,746 points |
| r ≥ 1 | 30 % |

## SPIFF

Il n'est **pas** activé par défaut dans le simulateur :

- Pour une unité dont le libellé contient `gr` (sans distinction de casse), poids kg = quantité / 1000.
- Pour les autres unités, poids kg = quantité × `unit_weight_kg` du catalogue ; si cette donnée manque, le code du simulateur utilise 0.
- SPIFF si interrupteur activé = poids kg × **50 € pour A** ou × **25 € pour B**, ajouté en plus de la commission normale.
- Le simulateur peut produire un SPIFF même si la marge est négative, dès lors que l'interrupteur est actif. Ne pas supposer que cette situation est admissible dans la rémunération réelle.

## Vérification contre l'interface fournie

| Simulation | Vente | Coût catalogue | Coût corrigé | Marge | Commission attendue |
|---|---:|---:|---:|---:|---:|
| GTA Slurp, 100 gr, catégorie A, 2,50 €/gr | 250 € | 1,40 €/gr | 1,75 €/gr | 75 € | **20,43 €** |
| TR Toad Venom 250, 1 unité, catégorie A, 800 €/unité | 800 € | 395 €/unité | 493,75 €/unité | 306,25 € | **91,09 €** |
| Total (sans SPIFF) | **1 050 €** | — | — | **381,25 €** | **111,51 €** |

Les neuf tests de régression couvrent ces montants, catégories A/B, plafonds, frais SPIFF, coût nul, et marge négative.

## Conditions avant le calcul réel de septembre

1. Lire la logique serveur `importOdooSales` et `recalcBatch` avec une autorisation valide, ou confronter suffisamment de commandes Odoo à des sorties Kino validées (statuts, vendeurs, avoirs, annulations, remises).
2. Confirmer l'unité de mesure et les conversions Odoo/Kino. Le catalogue disponible dans Companion expose notamment `tier`, `cost_eur` et `list_price_eur`, mais le poids unitaire / type `unit` n'est pas garanti pour tous les produits.
3. Ne pas traiter automatiquement les échantillons ou les livraisons comme des lignes rémunérables ; leurs exclusions officielles sont encore à valider.
4. Les six lignes sans SKU Odoo sont seulement **suggérées** à partir de leur préfixe de description retrouvé dans Kino, sans correction des références officielles.
5. Garder la commission de septembre au statut **simulation non validée** tant que la traçabilité des commandes et l'alignement sur les règles serveur ne sont pas établis.

Aucune modification d'Odoo et aucun calcul de paiement n'ont été déclenchés par l'extraction.

## D7 — Scénario hypothétique sur les lignes Odoo rapprochées

Une première connexion entre le moteur de simulation navigateur Kino et les commandes Odoo existe **uniquement dans le navigateur du propriétaire connecté**, et **ne nécessite aucune écriture Odoo**.

- Moteur : `assets/commission-scenario.mjs`. Présentation DOM sûre : `assets/commission-scenario-ui.mjs`.
- Affichage par **GTA**, **TR**, total théorique partiel, nombre de lignes simulées, motifs et décompte de lignes écartées, montant par commande et accès à la commande source.
- Ne simule que les lignes des commandes `sale` / `done`, `kind='candidate'`, `catalog_match.status='matched'`, catégorie A/B et coût / prix de catalogue strictement positifs. Les commandes au total source incohérent sont exclues.
- **Prix de vente effectif** = sous-total HT Odoo / quantité Odoo. Contrôle la cohérence avec prix unitaire × (1 − remise/100) × quantité, tolérance maximale 0,03 €.
- La **même unité** est **supposée** pour le coût du catalogue Kino et la quantité Odoo : le snapshot courant du catalogue ne contient ni unité de facturation ni coefficient de conversion. **Cette condition n'est pas vérifiée**, d'où le titre « Simulation conditionnelle — non acquise ». Des écarts potentiellement majeurs existent si le coût est par gramme et le prix par lot.
- Le SPIFF reste désactivé. Les 6 lignes sans SKU Odoo, les échantillons et livraisons, les commandes à 0 €, celles hors vente confirmée, les devises non EUR et les chiffres incohérents restent hors du scénario.
- Les montants sont agrégés **avant tout arrondi** conformément au calculateur Kino. Le total scénario n’est ni un montant validé, ni un paiement ou une dette.
- Les fonctions Kino serveur `importOdooSales` et `recalcBatch` restent inaccessibles ; les avoirs, commissions acquises, validation commerciale, et le traitement officiel des frais / échantillons ne sont pas reproduits.

**Prérequis à une rémunération suffisamment fiable :** relever les unités de facturation et les poids dans Kino, ainsi que l'unité Odoo, tester leur compatibilité par SKU et vérifier les règles serveur Kino. La préversion D7 ne modifie jamais les valeurs `commission_eur:null` du rapport source.

## D8 — Contrôle renforcé des statuts Odoo et commandes annulées

Le propriétaire a signalé des commandes considérées comme « Annulées » dans l'interface Odoo alors qu'elles semblent figurer dans la simulation de septembre. Le code D7 incluait déjà exclusivement les commandes dont `sale.order.state` était `sale` ou `done`. Sans référence précise ni copie du statut de la fiche Odoo, la cause de l'incohérence n'est **pas déterminée**. Une annulation peut intervenir après la lecture, ou le statut observé peut être celui de la facture/livraison plutôt que de la commande.

- La passerelle `commission-catalog-review` **v6** lit une seconde fois `sale.order` (`id`, `state`) **après** le chargement des lignes et des produits. Si une commande manque, change de statut ou renvoie des statuts impossibles à vérifier, la passerelle refuse le rapport avec une erreur contrôlée `odoo_order_state_changed` ou `odoo_order_status_unverifiable` (HTTP 409). Aucun état financier n'est calculé.
- Lorsqu'une relecture cohérente réussit, le rapport indique `source_order_status_rechecked:true` et `source_order_status_checked_at`. Cette vérification est **ponctuelle**, pas une garantie permanente : une annulation ultérieure peut survenir.
- Le simulateur ne montre des montants que si ces deux champs existent et sont valides. Les rapports antérieurs sans preuve de relecture n'affichent plus de scénario chiffré.
- La préversion **D8** affiche l'horodatage de la vérification Odoo et la liste des commandes dont le statut source est `cancel`, toujours exclues des montants. Le statut des commandes intégrées est présenté comme confirmé à la date de lecture.
- Tests : rejet sans preuve de relecture, exclusion des commandes annulées, invariance du rapport source, contrôle statique de la passerelle, test Chromium mobile.
- Préversion : `https://bradrien.github.io/weneed-companion-u/validation-v12/?build=D8`.

**À investiguer avec le propriétaire :** recueillir 1 à 3 références de commandes qu'il voit comme annulées dans Odoo, cliquer sur « Voir la commande » dans D8 après ↻, comparer les champs `sale.order.state` et les dates de dernière modification. Les remboursements ou avoirs sur une commande encore au statut `sale` nécessitent un contrôle distinct des factures et écritures comptables ; D8 ne le fait pas.
