# D34 — Couverture des sources et stocks

Les paramètres affichent toujours Gmail, Google Chat et Drive, même lorsqu’une source ne renvoie aucun état. Une fenêtre entièrement parcourue est distinguée d’un ancien horodatage de réussite. Les dates de couverture, les pages en attente, les échecs et un contrôle datant de plus de quinze minutes sont visibles. Une fenêtre vide terminée reste une réussite de collecte ; elle ne confirme pas l’analyse de tous les échanges ni la création de tâches. Les erreurs fournisseur brutes ne sont pas reproduites.

Les stocks valident les sociétés, les quantités signées et fractionnaires, la cohérence de l’horodatage du contrôle, les totaux et les pages de cinquante références. Les compteurs TR et GTA décrivent les catalogues complets ; la liste suit la société et la recherche choisies. Les alertes suivent la société et indiquent qu’elles sont indépendantes de la recherche produit.

Un changement de société, de recherche ou de page efface immédiatement l’ancienne liste et invalide ses requêtes. Une erreur d’actualisation conserve les quantités seulement pour le même filtre, avec leur date. Une réponse tardive ne peut plus remettre les produits d’une autre recherche à l’écran. Les opérations de notification sont également invalidées à la déconnexion, y compris après une permission ou une réponse retardée.

Les tests couvrent les fenêtres incomplètes, les sources absentes, les dates impossibles ou futures, les unités et quantités, les pages et les changements de session. Le parcours mobile ajoute les échecs réseau, les réponses tardives et les opérations de notification simulées. La réception d’une notification sur l’iPhone réel reste à tester depuis l’application installée.

Les contrôles réels du 11 octobre constatent une collecte Google couverte depuis le matin, sans rattrapage des échanges plus anciens, et un contrôle récent de 559 références de stock. Aucun périmètre historique supplémentaire n’est activé par cette version.
