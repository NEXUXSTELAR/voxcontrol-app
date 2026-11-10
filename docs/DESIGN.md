# Design

## Principes

1. **La voix d'abord.** L'accueil ne montre qu'un objet à toucher, un choix de mode et trois raccourcis.
2. **On n'ouvre pas une section pour agir : on agit, et la demande trouve sa place.** VoxControl propose la destination (Claude, PC, copie) ; tu peux la changer.
3. **Simple par défaut, puissant à la demande.** Le mode Affiner, les modèles d'IA et la relecture vivent dans le Studio, jamais sur l'accueil.
4. **Ce qui t'attend remonte en premier** : une autorisation demandée par Claude apparaît en haut, avec une pastille sur l'onglet.

## Organisation : quatre espaces

| Espace | Rôle | Inspiration |
|---|---|---|
| Parler | dicter ou écrire une demande | assistants vocaux (écran d'écoute épuré) |
| Claude | suivre, autoriser, reprendre | Linear (statuts, hiérarchie) |
| Studio | transformer une idée floue en prompt | outils de chaînes d'IA (étapes reliées) |
| PC | état de l'ordinateur et actions | apps de contrôle à distance (l'appareil d'abord) |

Le détail s'ouvre en **feuilles** qui montent du bas (au plus deux niveaux), sans jamais changer d'adresse : iOS coupe le micro des apps web quand l'adresse change. Sur grand écran, la feuille s'affiche à droite du contenu.

## Couleurs

Une couleur = un espace, utilisée en teinte de fond, pour les icônes et pour l'onglet actif. Pas de dégradé, pas de halo, pas de verre dépoli.

| Rôle | Clair | Sombre |
|---|---|---|
| Parler, bouton principal | `#FF4D12` | `#FF6A33` |
| Claude | `#6E56CF` | `#9E8CFC` |
| Studio | `#0B9484` | `#2BC4AE` |
| PC | `#2563EB` | `#6B9BFF` |
| Terminé | `#11795A` | `#3BC48F` |
| Attend ton accord | `#A86400` | `#F0A83A` |
| Erreur, action risquée | `#C01530` | `#FF5A6E` |

Toutes les couleurs sont des variables CSS en tête de `app/src/styles.css`.

## Typographie

- Interface : police du système (San Francisco sur iPhone, Segoe UI sur Windows).
- Ce qui sera envoyé tel quel (texte dicté, prompts, commandes) : IBM Plex Mono.
- Chiffres à chasse fixe pour que les mesures ne tremblent pas.

## Icônes et visuels

- Jeu d'icônes dessiné pour le projet (`app/src/ui/Icon.tsx`) : grille de 24, trait de 1,75, extrémités rondes. Pas d'emoji comme icône.
- Deux visuels 3D (ordinateur, sphère) dans `app/public/art/`. La dernière capture d'écran du PC s'affiche en perspective dans l'écran de l'ordinateur.

## Mouvement

Chaque animation explique un état : l'anneau de la sphère suit le volume réel de la voix ; la sphère respire pendant la transcription ; l'étape en cours tourne dans le Studio. Les feuilles montent en 260 ms. Tout s'arrête si l'iPhone demande de réduire les animations.

## États à prévoir pour chaque nouvel écran

Chargement, hors ligne, vide, en cours, attente de ton accord, réussite, erreur (message en français, avec une action pour réessayer), interruption.
