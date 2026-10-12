# D16 — Surveillance privée des stocks TR / GTA

## Suivi par référence — 12 octobre 2026

Les cartes produits sont ouvrables, y compris après une recherche. Le bouton « M’avertir du retour en stock » enregistre un suivi privé associé à la société et à l’identifiant Odoo exact, jamais au nom seul. L’activation ciblée configure cet appareil pour les retours des références suivies uniquement. Le choix « Toutes les ruptures et retours en stock » peut être appliqué explicitement dans les notifications. Les anciens abonnements globaux sont conservés jusqu’à ce choix.

Le suivi persiste après une actualisation ou reconnexion et peut être désactivé depuis la même fiche. Il vise les transitions de quantité disponible ≤ 0 vers > 0, après l’activation du suivi ; il ne renvoie pas les anciennes alertes. Les messages de retour identifient les produits. L’autorisation du téléphone et un abonnement actif restent requis pour recevoir une notification. Aucune quantité Odoo n’est modifiée.

La vue Stocks est accessible depuis Accueil, Paramètres ou `?view=stocks`. Le serveur interroge Odoo toutes les cinq minutes, même lorsque le navigateur est fermé. Elle montre uniquement les références actives, vendables, suivies en inventaire. Chaque société est lue dans son propre contexte Odoo. Les quantités disponibles excluent les réservations (`free_qty`), avec les unités originales.

Le premier relevé constitue une référence silencieuse. Une quantité passant de positive à zéro ou négative déclenche une rupture ; le passage inverse déclenche un retour. Les variations qui restent positives ne déclenchent pas de notification par défaut. Un relevé incomplet est rejeté et la dernière lecture réussie est conservée. Les relevés de plus de douze minutes sont signalés comme anciens.

Les notifications Web Push nécessitent l'autorisation de l'appareil. Sur iPhone, installer le Companion depuis Safari avec « Sur l'écran d'accueil », ouvrir cette icône, se connecter, puis choisir Stocks → Activer les notifications → Tester. Une réponse positive du service push confirme l'acceptation de l'envoi ; la réception réelle doit être confirmée sur le téléphone. Les notifications sont regroupées par société et contrôle, avec reprises limitées en cas d'échec. Un abonnement expiré est désactivé. Se désabonner via Désactiver ; la déconnexion du Companion ne coupe pas les notifications déjà activées.

## Accès et exploitation

La fonction `stock-monitor` valide elle-même l'authentification : JWT confirmé et accès propriétaire actif pour consulter/abonner un téléphone ; jeton dédié stocké dans Vault pour le contrôle programmé. Les tables sont privées, RLS activée ; les RPC sont réservées au rôle serveur. Les clés privées Web Push restent dans Vault, les abonnements chiffrés par le transport TLS et accessibles seulement au serveur. Aucun secret Odoo ni jeton du planificateur n'est inclus dans ce dépôt. Le service worker ne cache aucune réponse privée et ne reçoit aucun jeton de session.

Déployer les migrations stock puis push, la fonction `stock-monitor` avec `verify_jwt=false` (son corps contrôle les deux modes d'authentification), exécuter un premier contrôle via le jeton Vault, puis appliquer la planification. Les secrets Odoo préexistants sont requis. Les deux clés VAPID sont générées au premier contrôle et ne doivent pas être remplacées après abonnement des appareils.

Validation : tests du lecteur Odoo et des transitions, validation des destinations push, contrôle SQL exécuté dans une transaction annulée, accès anonyme refusé, contrôle automatique réel, recherche/filtre et interface mobile. La réception sur téléphone reste une validation utilisateur. Il n'y a aucune écriture Odoo et aucun calcul de commissions ajouté dans D16.
