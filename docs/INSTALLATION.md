# Installer VoxControl, pas à pas

Compte **environ 30 minutes** la première fois. Fais les étapes dans l'ordre : chacune prépare la suivante.

> Règle d'or : ne colle **jamais** une clé API dans une conversation avec une IA, ni dans un fichier du dépôt. Tu la colles uniquement dans l'app VoxControl, qui la range dans le coffre de Windows.

## Ce qu'il te faut

| | Pourquoi |
|---|---|
| Un PC sous **Windows 10 ou 11** | l'agent tourne dessus |
| **Claude Code** installé et connecté sur ce PC ([guide officiel](https://code.claude.com/docs)) | VoxControl le pilote avec ton compte |
| **Git** ([git-scm.com](https://git-scm.com)) | pour récupérer et mettre à jour VoxControl |
| Un **iPhone** sous iOS 16.4 ou plus récent | pour les notifications des apps web |
| Un compte **[Tailscale](https://login.tailscale.com/start)** (gratuit en usage personnel) | le tunnel privé entre iPhone et PC |
| Facultatif : une clé **[Mistral](https://console.mistral.ai)** | dictée et mode Affiner (2 à 5 € par mois) |

Node.js 24 et Tailscale sont installés par le script s'ils manquent.

---

## Partie 1 — Sur le PC

### 1.1 Récupérer VoxControl

Ouvre **PowerShell** (touche Windows, tape « PowerShell ») et colle :

```powershell
cd $HOME\Desktop
git clone https://github.com/NEXUXSTELAR/voxcontrol-app.git
cd voxcontrol-app
```

### 1.2 Lancer l'installation

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Le script, dans l'ordre :

1. installe **Node.js 24** si besoin ;
2. installe les dépendances et **construit l'application** (2 à 10 minutes la première fois) ;
3. installe **Tailscale** si besoin et te demande de **te connecter** (une fenêtre s'ouvre) ;
4. publie l'agent en **HTTPS privé** avec Tailscale Serve ;
5. crée le **démarrage automatique** (tâche planifiée « VoxControl ») et un **raccourci sur le Bureau** ;
6. te propose de **désactiver la veille sur secteur** (un PC en veille ne répond pas) ;
7. lance VoxControl et l'ouvre dans ton navigateur.

**Si le script affiche « Serve is not enabled on your tailnet »** : ouvre le lien qu'il affiche, clique **Enable**, puis relance le script. C'est une autorisation à donner une seule fois dans ton compte Tailscale.

### 1.3 Vérifier

- Une **icône VoxControl** apparaît dans la zone de notification (en bas à droite, parfois derrière la flèche ^).
- La page `http://localhost:47821` s'ouvre et affiche l'écran **Parler**.
- Ton adresse privée apparaît dans Réglages › Connexions › Tailscale, sous la forme `https://ton-pc.ton-reseau.ts.net`.

---

## Partie 2 — Sur l'iPhone

### 2.1 Installer Tailscale (5 min)

1. App Store › **Tailscale** › installer.
2. Se connecter avec **le même compte** que sur le PC.
3. Accepter l'ajout de la configuration VPN (Face ID ou code).
4. Vérifier : l'interrupteur en haut est activé et ton PC apparaît avec un point vert.

Si le PC n'apparaît pas, c'est presque toujours un autre compte : déconnecte-toi et reconnecte-toi avec le bon.

### 2.2 Installer l'app VoxControl (3 min)

1. **Sur le PC** : roue crantée › Appareils › **Appairer**. Un **QR code** et un **code de 6 caractères** s'affichent (valables 5 minutes).
2. **Sur l'iPhone** : vise le QR code avec l'Appareil photo et ouvre le lien dans **Safari**. Le premier chargement peut prendre 10 à 20 secondes.
3. Dans Safari : bouton **Partager** › **Sur l'écran d'accueil** › **Ajouter**.
4. Ferme Safari et ouvre VoxControl **depuis la nouvelle icône**.

> Sur iPhone, Safari et une app ajoutée à l'écran d'accueil n'ont pas la même mémoire. Si tu appairais dans Safari, l'appairage serait perdu à l'ouverture depuis l'icône : appaire toujours depuis l'icône.

### 2.3 Relier l'iPhone au PC (1 min)

Tape le **code de 6 caractères** affiché sur le PC, garde ou change le nom de l'appareil, puis **Relier**. Sur le PC, « Téléphone appairé » s'affiche.

### 2.4 Face ID et notifications (2 min)

Sur l'écran Parler, touche la ligne **« À finir : … »** :

- **Face ID** › Activer : une clé d'accès est créée dans ton trousseau ; le PC ne voit jamais ton visage. Elle sera demandée pour les actions sensibles.
- **Notifications** › Activer › Autoriser, puis **Tester**.

---

## Partie 3 — Les IA (facultatif mais recommandé)

### 3.1 Clé Mistral : dictée et mode Affiner

1. Crée un compte sur [console.mistral.ai](https://console.mistral.ai) et ajoute un moyen de paiement (**Billing**). Fixe une limite de dépenses.
2. Sur [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) : **Create new key**, puis copie la clé.
3. Dans VoxControl : Réglages › Connexions › **Mistral** › colle la clé › **Enregistrer et tester**. Le point devient vert.

### 3.2 Deuxième avis : OpenAI ou Gemini

Même principe, dans Réglages › Connexions :

- OpenAI : [platform.openai.com/api-keys](https://platform.openai.com/api-keys), avec un plafond dans Settings › Limits.
- Gemini : [aistudio.google.com/apikey](https://aistudio.google.com/apikey). En formule gratuite, Google peut utiliser tes requêtes pour entraîner ses modèles.

### 3.3 Plafond mensuel

Réglages › Dépenses › **Plafond mensuel** : au-delà, VoxControl n'appelle plus aucune IA.

---

## Partie 4 — Première utilisation

1. Onglet **Claude** : choisis ou ajoute ton **projet** (le dossier dans lequel Claude Code travaille).
2. Onglet **Parler**, mode **Direct** : touche la sphère, autorise le micro, dis *« Résume-moi ce projet en trois phrases »*, puis touche de nouveau.
3. Une demande courte et claire part vers Claude **au bout de 3 secondes** (touche l'écran pour corriger avant).
4. Onglet **Claude** : suis la tâche en direct. Si Claude veut lancer une commande ou modifier un fichier, une **carte orange** apparaît : Autoriser, Refuser ou Toujours (pour la session).
5. Essaie le mode **Affiner** avec une demande vague : le **Studio** prépare un prompt précis que tu relis avant l'envoi.

---

## Partie 5 — Bureau à distance (facultatif)

Pour voir l'écran du PC, **PC › Voir l'écran** suffit souvent. Pour le contrôler à la souris :

1. Sur le PC : clic droit sur `scripts\enable-rdp.ps1` › **Exécuter avec PowerShell** (accord administrateur demandé). Le bureau à distance n'est ouvert qu'aux appareils Tailscale.
2. Sur l'iPhone : App Store › **Windows App** (Microsoft).
3. Ajouter un PC avec ton adresse Tailscale. Identifiants : ton compte Windows. Avec un compte Microsoft, il faut le **mot de passe** (pas le code PIN).

Le bureau à distance de Windows demande **Windows Pro** ou une édition supérieure. Sur Windows Famille, utilise [RustDesk](https://rustdesk.com) ou [Chrome Remote Desktop](https://remotedesktop.google.com).

---

## Réglages utiles

| Où | Option |
|---|---|
| Réglages › Affichage et voix | thème, envoi automatique, transcription en direct, lecture à voix haute, icône claire ou sombre |
| Réglages › Sécurité › Dossiers, applications et scripts | ce que le téléphone peut voir et lancer (Face ID) |
| `%LOCALAPPDATA%\VoxControl\config.json` | `blockedDrives` : lecteurs jamais visibles depuis le téléphone, par exemple `["D:"]` (redémarre l'agent après modification) |

---

## Dépannage

| Symptôme | Que faire |
|---|---|
| « PC injoignable » | Le PC est-il allumé et pas en veille ? Tailscale est-il activé sur l'iPhone ? |
| L'app reste sur « Connexion au PC… » | Sur le PC : clic droit sur l'icône VoxControl › Redémarrer l'agent. |
| Plus d'icône sur le PC | Elle se relance seule sous 5 minutes, ou double-clique le raccourci du Bureau. |
| « Appareil non reconnu » | L'appareil a été révoqué : refais les étapes 2.2 et 2.3. |
| La dictée ne marche pas | Réglages › Connexions › Mistral › Tester, et vérifie ton crédit Mistral. |
| Voir ce qui s'est passé | Clic droit sur l'icône › Voir le journal, ou dans l'app : Réglages › Journal des actions. |

Journaux sur le PC : `%LOCALAPPDATA%\VoxControl\agent.log` (agent) et `tray.log` (icône).

## Mettre à jour

Dans l'app : Réglages › Mise à jour › **Vérifier**, puis **Mettre à jour** (Face ID). Ou à la main :

```powershell
cd $HOME\Desktop\voxcontrol
git pull
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

## Désinstaller

1. Clic droit sur l'icône › Quitter.
2. Planificateur de tâches › supprimer la tâche **VoxControl**.
3. Supprimer le dossier `voxcontrol` et `%LOCALAPPDATA%\VoxControl`.
4. Gestionnaire d'identification Windows › Informations d'identification Windows › supprimer les entrées **VoxControl**.
5. Facultatif : `tailscale serve --https=443 off`.
