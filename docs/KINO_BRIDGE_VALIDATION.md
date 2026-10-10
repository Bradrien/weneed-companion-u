# Kino Bridge 0.7 — comparaison avec la 0.6

## Source récupérée le 10 octobre 2026

Archive : `WeNeed_Companion_Kino_Bridge_v0.6.zip`, 13 480 octets.
SHA-256 : `b42b47ca0ba1467682beecc2070b5c44e0015891e3bda32e9d7b519d93fbff12`.
Le manifeste de l'archive porte la version 0.6.0. L'archive n'est pas republiée dans ce dépôt public.

## Comparaison et choix

| Élément de la 0.6 | Traitement dans la candidate 0.7 |
|---|---|
| Suggestions `li`, `div[role=button]`, classes `cursor-pointer` / `hover:` | Réintégrées, avec limites géométriques et classification stricte SKU + GTA/TR + nom. |
| Exclusion des filtres catalogue, navigation, en-tête, table | Conservée ; les boutons de catégorie ne sont pas des suggestions produit. |
| Reconnaissance du produit par un nom codé en dur pour AB/I | Non reprise : un nom seul ne confirme ni le SKU ni la société. |
| Délai d'observation de 1 700 ms | Conservé ; une absence de résultat reste une observation à cet instant, pas une preuve d'absence au catalogue. |
| Diagnostic local : saisie prise en compte, liste détectée, éléments écartés | Réintégré dans le popup, sans copier la saisie préexistante de l'utilisateur. |
| Nettoyage inconditionnel et seconde tentative forcée | Remplacés par la protection de saisie concurrente de la 0.7 ; un échec de nettoyage reste un échec. |
| Catalogue et inspection des contrôles | Algorithmes inchangés entre les sources comparées, avec verrouillage croisé catalogue/recherche en 0.7. |
| Accès Chrome et domaines | Identiques ; aucune nouvelle permission. |

La passerelle Supabase actuellement déployée conserve les candidats et le statut de restauration, mais ne persiste pas les diagnostics supplémentaires de recherche. Le popup les affiche localement ; aucun changement serveur n'est requis pour ces corrections.

## Validation automatisée

`npm test` et `npm run check:bridge` couvrent les fonctions isolées, le protocole de messages simulé et la syntaxe.

`npm run test:bridge-browser` charge le véritable manifeste MV3 dans un profil Chromium temporaire : popup, service worker, scripts dans leur monde isolé et événements natifs du champ. La page Kino est **entièrement synthétique**, servie par interception réseau. Les requêtes externes sont bloquées et aucun identifiant réel n'est utilisé.

Ce test vérifie les variantes de suggestions récupérées de la 0.6, l'exclusion des filtres, le vidage du champ, l'absence de sélection de produit, les recherches vides, les brouillons utilisateur et les recherches concurrentes. Il est exécuté par `.github/workflows/bridge-browser.yml` avec Playwright 1.56.1.

Le lancement Chromium local est bloqué dans l'environnement de travail par `socket() failed: Operation not permitted`. Le résultat GitHub Actions fait foi pour ce test ; ne pas confondre ce blocage de lancement avec une erreur de l'extension.

## Validation réelle encore nécessaire

Cette validation ne reproduit pas les composants React internes de Kino ni la session professionnelle. Suivre `kino-bridge/INSTALLATION.txt` dans Chrome professionnel, vérifier les deux sociétés et conserver le bridge précédent pour retour arrière. La version reste candidate tant que cette étape n'est pas terminée.
