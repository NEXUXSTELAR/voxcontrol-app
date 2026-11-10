# Contribuer à VoxControl

Merci de vouloir améliorer VoxControl. Toute aide compte : signaler un bug, proposer une idée, corriger une faute, ajouter une fonction ou une traduction.

## Avant de commencer

- **Une idée ou un bug ?** Ouvre une [issue](../../issues) avec le modèle adapté. Pour une grosse fonction, discute-la d'abord dans une issue : ça évite de travailler pour rien.
- **Une faille de sécurité ?** Pas d'issue publique : suis [SECURITY.md](SECURITY.md).

## Préparer son poste

Il faut Windows 10 ou 11, [Node.js 24](https://nodejs.org) et [Git](https://git-scm.com). Claude Code et Tailscale ne sont nécessaires que pour tester les fonctions qui les utilisent.

```powershell
git clone https://github.com/NEXUXSTELAR/voxcontrol-app.git
cd voxcontrol-app
npm install
npm run build          # construit l'app dans app/dist
npm start              # lance l'agent sur http://localhost:47821
```

Pour travailler sur l'interface avec rechargement instantané, lance l'agent dans un terminal et Vite dans un autre :

```powershell
npm start
npm run dev:app        # http://localhost:5173, les appels /api partent vers l'agent
```

Pour ne pas toucher à ta propre installation pendant le développement, isole l'agent :

```powershell
$env:VOX_PORT = '47890'
$env:VOX_DATA_DIR = "$env:TEMP\vox-dev"
$env:VOX_KEYRING = 'VoxControlDev'
npm start
```

## Organisation du code

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). En résumé :

- `agent/src/` : l'agent Node.js (TypeScript exécuté directement par Node 24, sans compilation) ;
- `app/src/` : l'app React (Vite) ;
- `scripts/` : installation et icône Windows ;
- `tests/` : tests de sécurité.

## Règles du projet

- **La sécurité d'abord.** Une nouvelle action Windows doit avoir un niveau de risque dans `LEVELS` (`agent/src/main.ts`) ; tout ce qui modifie, supprime ou expose quelque chose est au moins de niveau 2 (Face ID). Jamais de commande libre envoyée depuis le téléphone.
- **Aucun secret dans le code**, les journaux ou les réponses envoyées au téléphone.
- **Pas de nouvelle dépendance sans raison.** Explique pourquoi dans la PR.
- **Une seule page, sans changement d'adresse** côté app : iOS coupe le micro sinon. Les écrans s'ouvrent en feuilles (`nav.open`).
- **Design** : une couleur par espace, pas de dégradé ni de halo, icônes du jeu `app/src/ui/Icon.tsx` (trait de 1,75), textes en français clair, au tutoiement.
- **Commentaires** : seulement pour expliquer *pourquoi*, pas *quoi*.

## Vérifier avant d'envoyer

```powershell
npm run build          # vérifie aussi les types de l'app
npm test               # tests de sécurité sur une copie isolée de l'agent
```

Si tu modifies l'interface, ajoute une capture (iPhone, 390 × 844) à ta PR.

## Proposer une modification

1. Crée une branche : `git checkout -b ma-fonction`.
2. Fais des commits petits, avec un message qui explique le fond (en français ou en anglais).
3. Ouvre une Pull Request et remplis le modèle : ce qui change, pourquoi, comment tu l'as testé.

## Idées pour se lancer

| Idée | Difficulté |
|---|---|
| Traduction de l'interface en anglais (avec un sélecteur de langue) | moyenne |
| Raccourci Siri : envoyer une demande dictée sans ouvrir l'app (jeton limité à « envoyer à Claude ») | moyenne |
| Rendu des tableaux Markdown dans les réponses de Claude | facile |
| Réveil du PC à distance (Wake-on-LAN) via un autre appareil du réseau | difficile |
| Agent pour macOS ou Linux (remplacer PowerShell et le coffre Windows) | difficile |
| Notification « PC hors ligne » quand l'agent ne répond plus | moyenne |
| Mode « lecture seule » par appareil (voir sans agir) | moyenne |

## Code de conduite

Sois bienveillant et constructif. Les critiques portent sur le code, jamais sur les personnes. Les comportements irrespectueux entraînent l'exclusion du projet.
