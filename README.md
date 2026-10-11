# WeNeed Companion

Companion commercial avec commandes et stocks Odoo en lecture seule, authentification Supabase et accès propriétaire vérifié côté serveur.

La préversion en cours est disponible sur [validation-v12](https://bradrien.github.io/weneed-companion-u/validation-v12/). La page principale conserve sa version antérieure.

## Commissions — D33

- Bilan par mois, société et recherche, avec séparation des devis non confirmés et des commandes confirmées/facturées.
- Rapprochement Kino strict par société et SKU. Un code dans un libellé reste un candidat si le champ SKU Odoo est vide.
- Réconciliation conservatrice gramme/sachet ; les unités ambiguës, coûts nuls et références absentes restent non estimés.
- Décomposition par ligne et calcul commun au serveur, au scénario confirmé et au détail des commandes ; arrondi au centime par ligne.
- Provenance horodatée du catalogue et seconde lecture bornée des prix, remises, montants et états Odoo.
- Export CSV de la sélection avec diagnostics, valeurs signées, protection des textes et commissions suspendues laissées vides.
- Lecture des factures et avoirs à la demande dans chaque commande : état comptable, état de paiement Odoo, solde restant et seconde vérification des liens et documents.
- Dossier CSV ciblé des contrôles de source et exclusions à confirmer, avec le même mois, la même société et la même recherche que le bilan. Actions proposées et liens vers les pièces Odoo, sans modifier les sources.
- Accès au détail d'une commande depuis le bilan et liens directs vers la commande, ses factures et ses avoirs dans Odoo.

Les simulations utilisent une capture du catalogue actuel et restent provisoires. Les coûts historiques, le SPIFF et les exclusions contractuelles ne sont pas validés. Le déclenchement à la confirmation et la déduction des commissions de retour sont établis ; les pièces enregistrées sont présentées séparément. Les factures et avoirs présentent leurs montants complets : une facture peut couvrir plusieurs commandes, aucune allocation ni déduction de commission n'est faite. Le statut facturé Odoo ne constitue pas une preuve de règlement ; même l'indication payé ne valide pas la rémunération. Aucun montant n'est déclaré acquis ou payable.

## Sources et archives — D35

Les paramètres indiquent la fenêtre effectivement couverte par Gmail, Google Chat et Drive, les reprises et les contrôles en retard. Une synchronisation récente ne signifie pas que les anciens échanges ont été récupérés ou analysés.

Les stocks TR/GTA suivent la société, la recherche et la page sélectionnées. Les totaux du catalogue et les dernières alertes sont identifiés séparément. Les anciennes réponses de recherche et de notification sont ignorées après un changement de filtre ou de session.

Les archives WhatsApp présentent leur période, leurs conversations approuvées et leurs vocaux disponibles ou transcrits. Les exclusions sont appliquées aux compteurs et aux pages. Le suivi du pilote distingue la réserve estimée du coût effectif ; aucune nouvelle transcription n'est lancée. Les anciens échanges restent sans création de tâches actuelles et le rattachement à un client demande un choix explicite.

## Tâches par client — D36

La fiche client ouvre ses tâches avec un filtre sur son identifiant exact. Les créations préselectionnent la fiche choisie et les compteurs CRM sont relus après une modification. Les pages et acquittements vérifient leurs identifiants et versions ; les réponses tardives restent liées à leur session et la reprise d'un enregistrement non confirmé conserve sa demande d'origine. Les statuts et dates Rappels restent des informations de synchronisation, avec les motifs connus de non-envoi.

## Confirmation et retours — D37

La commande confirmée déclenche la commission. Les commissions des retours se déduisent du total final, suivant les pièces Excel vérifiées. Le bilan montre séparément la base estimée des commandes confirmées, les déductions enregistrées dans le mois et le solde estimé après ces déductions. Les retours de commandes plus anciennes peuvent rendre ce solde négatif. Les sources indiquent le fichier, l’onglet et les cellules de déduction.

La lecture porte sur les déductions enregistrées, sans garantir le rapprochement de tous les retours Odoo. Une liste vide ne confirme pas l’absence de retour. Une recherche ciblée ou une lecture non revérifiée suspend le solde du mois. Les coûts historiques et le SPIFF restent à vérifier.

## Avoirs mensuels — D38

Le bilan peut lire à la demande les avoirs Odoo du mois, leur facture d’origine et les ventes liées. Les liens natifs et les références exactes dans les notes sont distingués. La comparaison affiche les lignes des pièces source et les diagnostics empêchant une déduction. Lorsqu’une ligne concorde, le détail présente le prorata de commission estimé sur sa quantité retournée, fondé sur le catalogue actuel et revérifié dans le navigateur.

Une simulation du solde peut intégrer les avoirs rapprochés estimés, tout en conservant séparément les déductions Excel enregistrées. Elle demande la même capture Kino pour les ventes et les avoirs et des lectures récentes ; elle reste partielle et ne crée aucune déduction enregistrée. Une pièce déjà renseignée pour la même commande et le même mois est signalée ; aucun montant d’avoir HT n’est ajouté comme commission. Cette lecture couvre les avoirs attribués au commercial, sans garantir tous les retours physiques.

## Sécurité

Le dépôt GitHub Pages est public : aucun secret, document client ou jeu de données commerciales ne doit y être ajouté. La clé Supabase publiable du navigateur est publique par conception ; les secrets Odoo et les clés de service restent côté serveur. Les tables catalogue sont privées et ne sont lues qu'après contrôle propriétaire. Aucune commande Odoo n'est modifiée.

## Vérification

Le workflow GitHub vérifie la syntaxe, les modèles et fonctions avec des données synthétiques, les contrôles SQL isolés et les parcours Chromium sur écran mobile. Les validations réelles des données se font par les API authentifiées, sans publier leurs réponses ni leurs jetons.

Les changements récents sont décrits dans [D30_CHANGELOG.md](D30_CHANGELOG.md), [D31_CHANGELOG.md](D31_CHANGELOG.md), [D32_CHANGELOG.md](D32_CHANGELOG.md), [D33_CHANGELOG.md](D33_CHANGELOG.md), [D34_CHANGELOG.md](D34_CHANGELOG.md), [D35_CHANGELOG.md](D35_CHANGELOG.md) [D36_CHANGELOG.md](D36_CHANGELOG.md) [D37_CHANGELOG.md](D37_CHANGELOG.md) et [D38_CHANGELOG.md](D38_CHANGELOG.md).
