# Archives WhatsApp privées — D17

Les conversations conservées dans l’export WhatsApp sont consultables depuis « Archives WhatsApp » à l’accueil et depuis les fiches clients. Les vocaux originaux restent écoutables, avec leur transcription lorsqu’elle existe.

- Recherche des conversations par nom ou numéro ; filtre « À vérifier ».
- Recherche des messages dans les textes et les transcriptions disponibles.
- Historique par pages de 60 messages, du plus récent au plus ancien.
- Rattachement automatique uniquement sur une correspondance de numéro unique et vérifiée dans le CRM. Les identifiants LID nécessitent une correspondance exacte dans la sauvegarde des contacts.
- Rattachement manuel des conversations restantes à une fiche choisie par le propriétaire.
- Les exclusions préparées avant l’import sont conservées. Les archives ne créent pas de nouvelles tâches actuelles à partir d’anciens échanges.

Les textes, numéros, vocaux, transcriptions et données d’import restent dans Supabase. Ce dépôt public contient uniquement le logiciel. Les fichiers audio sont dans un espace privé ; un lien d’écoute de 15 minutes est délivré après vérification de la session propriétaire. Aucune réponse authentifiée n’est mise en cache par le service worker.

Le premier lot de transcription a été explicitement autorisé avec un plafond de 1 USD. Il est limité à 50 vocaux, au plus deux par client. Une réserve du double du coût des minutes arrondies est consommée avant chaque appel API. La réserve totale est limitée à 0,60 USD pour laisser une marge sous le plafond. Aucune tentative payante n’est automatiquement répétée et aucun traitement continu des archives n’est programmé. L’audio original reste la référence : les transcriptions peuvent contenir des erreurs.

Validation : tests des identifiants, des curseurs et de la durée WAV ; contrôle SQL avec rollback de la pagination, des exclusions, des permissions, du plafond et de l’interdiction des tentatives répétées ; contrôle de la consultation et de la lecture d’un vocal dans le navigateur. Le test sur le téléphone du propriétaire reste à faire.
