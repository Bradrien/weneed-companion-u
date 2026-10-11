# D36 — Tâches par client et validité des enregistrements

La fiche CRM permet d’ouvrir les tâches de son client exact. Le filtre utilise son identifiant, le nom apparaît dans le périmètre affiché et le formulaire de création préselectionne cette fiche. Le propriétaire peut encore choisir un autre client ou une action sans client. Un bouton rétablit la vue de toutes les tâches. Les compteurs et actions de la fiche CRM sont relus après une modification.

Les pages vérifient les statuts, identifiants, versions de source, échéances et limites de deux cents tâches. Une réponse qui contient une tâche d’un autre client ou d’un autre statut est refusée. Changer un filtre invalide immédiatement l’ancienne lecture ; un échec de lecture n’affiche plus les anciennes tâches sous le nouveau filtre. La déconnexion remet également le client, le statut, la recherche et la page à zéro.

Les enregistrements utilisent une génération distincte des lectures et de la session. Une réponse ou une fin de traitement d’une ancienne session ne peut pas interrompre un nouvel enregistrement, effacer sa progression ou afficher un bouton de reprise prématuré. Les recherches différées de clients et de tâches sont annulées à la déconnexion.

L’acquittement d’une modification doit désigner la tâche attendue. Un acquittement incomplet ou portant un autre identifiant reste non confirmé et conserve le même identifiant de demande pour la reprise. La déduplication explicite à la création et le regroupement vers la tâche choisie restent pris en charge. Les contrôles de version et d’idempotence côté serveur continuent de s’appliquer.

Les tâches montrent la date de synchronisation Rappels et distinguent une clôture synchronisée. Lorsqu’un rappel n’est pas envoyé, le motif de source connu est affiché sans transformer une ancienne extraction en action actuelle.

Les tests couvrent les pages, les statuts et clients incompatibles, les réponses non confirmées, deux enregistrements dans deux sessions successives, un retour tardif de lecture, le formulaire par client et la réactualisation du CRM. Les tests de création/report/clôture et de réponse réseau perdue restent dans le workflow. Aucun enregistrement de tâche réelle n’est effectué pendant ces contrôles.
