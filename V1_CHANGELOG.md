# V1 — Espace commercial mobile

L’accueil charge le bilan du mois courant et les priorités CRM à la connexion. Il présente les commandes confirmées, le CA HT, une estimation de commissions distincte des montants de vente et les actions en retard. Les chiffres restent indisponibles plutôt que zéro lorsqu’une lecture échoue ou vieillit. La consultation des commandes, stocks et archives reste accessible depuis les raccourcis et le menu Plus.

Les rapports historiques, diagnostics, exports et documents détaillés se déplient à la demande. Les fiches client montrent les contacts et les actions avant la mémoire et les historiques. Les coordonnées valides permettent d’ouvrir le téléphone ou l’e-mail. Une relance, ou une recommandation du portefeuille, ouvre un brouillon associé au client exact ; aucun enregistrement n’a lieu avant le bouton Enregistrer. Les sources, calculs et liens Odoo restent consultables.

Le rapprochement produit tolère accents, casse, espaces et ponctuation ; une seule faute dans un mot long peut être acceptée. Les nombres, grammages, société et variantes « + » restent distincts. Un SKU officiel trouvé reste prioritaire. Une référence proposée ou un nom ne sert au calcul que si le catalogue offre une seule correspondance compatible. Une petite faute dans le premier segment long d’un SKU exige un nom identique et conserve tous les autres segments. Les informations d’origine restent conservées, avec le code et la méthode de rapprochement dans le détail et le CSV.

Un avoir peut rapprocher deux fiches produit distinctes lorsqu’il existe une facture d’origine explicite, une seule ligne compatible, les mêmes unités et prix nets, une liaison unique vers la vente et des libellés compatibles. Les noms des produits sont ensuite revérifiés avec les autres sources. Une variante, un prix différent ou une ambiguïté suspend la déduction estimée. Les commissions utilisent les coûts actuels Kino ; SPIFF, coûts historiques et exhaustivité des retours restent hors validation.

Les lectures de produits incluent les fiches archivées reliées aux ventes retenues. Archiver un produit ne fait plus disparaître son SKU de l’historique et ne le remet pas en stock actif. Les mêmes identifiants bornés sont utilisés avant et après la lecture.

La déconnexion efface aussi les données commerciales rendues. Les brouillons de relance vérifient la session et le client après leur lecture et ne survivent pas à une déconnexion. Aucune écriture Odoo, émission de message, notification réelle ni nouvelle transcription audio n’est déclenchée par cette version.

Validation : calculs et contrôles de provenance, scénarios de noms voisins et de variantes, lectures réelles authentifiées, parcours mobiles, mises en page de 320 à 1440 px, création d’action depuis le développement client, déconnexion et captures visuelles sur données synthétiques. Les pièces et réponses réelles restent privées.
