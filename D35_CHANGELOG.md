# D35 — Archives approuvées et suivi du pilote

Le résumé des archives est calculé sans plafond de lignes à partir des conversations approuvées de la source historique. Les exclusions courantes s’appliquent aux conversations, messages attendus, vocaux disponibles, transcriptions et compteurs des travaux du pilote. Les transcriptions achevées restent distinctes des vocaux simplement conservés. Les dates de couverture et de lecture sont affichées.

Les conversations sont paginées par cent avec un ordre stable. L’écran indique combien sont chargées et avertit lorsque la recherche ne couvre pas encore toute la liste. Une variation du total ou une conversation répétée pendant une reprise exige une actualisation. Les anciens aperçus peuvent encore demander jusqu’à cinq cents conversations.

Le pilote présente ses demandes terminées, en attente, en cours ou en échec, ainsi que son plafond et sa réserve estimée. La réserve technique ne constitue pas une facture effective. Cette version ne crée aucun travail de transcription, ne relance pas un vocal et ne crée aucune tâche à partir d’un ancien échange.

Les réponses de messages vérifient le client ou la conversation demandée, les identifiants d’origine, l’ordre chronologique et le curseur. Les transcriptions apparaissent uniquement lorsqu’elles sont terminées et associées à un fichier vérifié. Les cartes affichent les références d’archive et de message. Les textes restent du texte littéral, les liens de lecture vocale restent limités au stockage privé du projet.

Les réponses d’aperçu, de fiche et de lecture vocale sont invalidées après une navigation ou une déconnexion, même si une nouvelle session est déjà ouverte. Le rattachement manuel conserve le choix explicite du propriétaire et invalide les aperçus précédents.

La migration ajoute deux lectures sous le rôle de service, sans accès direct anonyme ou utilisateur aux RPC. L’Edge Function vérifie toujours le compte propriétaire confirmé. Les tests SQL isolés couvrent les exclusions ajoutées, les sources étrangères, les fichiers hors conversation approuvée, la pagination, le rattachement exact et les droits. Le parcours mobile couvre le pilote, les textes originaux, la recherche, les pages, le rattachement volontaire et les réponses tardives.

Les données réelles du 11 octobre comportent 276 conversations approuvées, dont 88 rattachées, 34 711 messages, 4 053 vocaux disponibles et 50 transcriptions achevées. Les autres vocaux restent conservés sans transcription ; l’extension du pilote n’est pas activée.
