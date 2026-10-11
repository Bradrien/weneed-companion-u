# D24 — Actions et connexions

Le propriétaire peut créer une tâche, modifier son contexte ou son échéance, confirmer une suggestion, terminer une action, annuler une tâche et regrouper un doublon. Les écritures vérifient la version précédente et réutilisent le même identifiant après une réponse perdue. Les changements alimentent la synchronisation Rappels Apple ; un ancien acquittement ne peut plus écraser une modification récente.

Gmail, Google Chat et Drive suivent toutes les pages avec un curseur durable et un verrou par source. La première fenêtre couvre les dix minutes courantes ; les reprises suivantes utilisent une borne fixe et un chevauchement de dix minutes. Le statut distingue passage complet, reprise, échec et limite de lecture. Les documents trop volumineux conservent leurs métadonnées sans bloquer la file ; leur texte est explicitement indisponible. Aucun rattrapage historique ni changement du traitement IA n’est activé.

Les commissions conservent les signes Odoo, rapprochent les montants avec leurs lignes et suspendent une estimation incohérente. Deux lectures bornées vérifient que les lignes et commandes n’ont pas changé pendant la consultation. Les monnaies ne sont pas additionnées entre elles. Les montants restent provisoires : unités, coûts historiques, SPIFF, exclusions contractuelles, avoirs et déclenchement du paiement attendent une validation métier.

Validation : tests des mutations et des acquittements avec transaction annulée sous le rôle réel du service, contrôles financiers synthétiques, pagination/reprise et SQL isolés, parcours mobile de création/report/clôture et réponse réseau perdue. Les essais finaux sur le téléphone et la restauration des sauvegardes restent à effectuer.
