# D32 — Factures et avoirs Odoo à la demande

Dans le détail d'une commande du pipeline Commissions, « Lire les factures Odoo » consulte uniquement les factures liées à cette commande et les avoirs qui contre-passent directement ces factures. Aucune lecture comptable ne se lance à l'ouverture de la page. Les documents montrent leur état comptable, leur état de paiement Odoo, leur date, leurs montants complets et leur solde restant.

Le service impose une session propriétaire confirmée, le commercial Odoo du service, une société GTA/TR et une limite de 60 documents. Les liens de la commande, les factures et le périmètre des avoirs sont relus avant la réponse. Une modification concurrente, un document inaccessible ou une réponse incohérente suspend la lecture. Aucun appel de modification Odoo n'est effectué.

Une actualisation comptable efface d'abord les anciens états. Le changement de mois, l'actualisation mensuelle et la déconnexion invalident les lectures en mémoire ; une ancienne réponse ne peut les restaurer. Le navigateur contrôle la version, le périmètre, les décomptes, les relations de contre-passation et les incohérences payé/solde. Un changement des données de commande depuis le bilan est signalé.

Les montants restent ceux du document entier et peuvent couvrir plusieurs commandes. Ils ne sont ni affectés à la commande ni déduits de la simulation. « Indiqué payé dans Odoo » désigne exclusivement un état comptable ; les commissions restent non validées. Les coûts historiques, le SPIFF et les règles de rémunération restent à établir.

Validation : données synthétiques pour les droits, les périmètres bornés, les ajouts/retraits et modifications concurrentes, les avoirs, les monnaies, les paiements incohérents et les réponses tardives ; parcours mobile à la demande et refus d'actualisation ; lectures réelles authentifiées sur des commandes GTA/TR facturées et un devis sans facture. Les réponses privées ne sont pas publiées.
