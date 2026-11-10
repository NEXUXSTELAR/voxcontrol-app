# Politique de sécurité

VoxControl donne accès à un PC et à Claude Code depuis un téléphone : chaque signalement est pris au sérieux.

## Signaler une faille

**N'ouvre pas d'issue publique.** Utilise le bouton **« Report a vulnerability »** de l'onglet **Security** du dépôt (signalement privé GitHub).

Indique si possible :

- la version ou le commit concerné ;
- les étapes pour reproduire ;
- l'impact (ce qu'un attaquant pourrait faire, et dans quelles conditions : sur le réseau Tailscale, avec un appareil appairé, etc.).

Tu recevras une réponse sous 7 jours. Une fois la faille corrigée, ton signalement sera mentionné dans le journal des versions si tu le souhaites.

## Périmètre

Dans le périmètre : contournement de l'appairage, de Face ID ou des niveaux de risque, accès à des fichiers hors des dossiers autorisés, fuite de clé API, exécution de commande non prévue, injection via une réponse d'IA.

Hors périmètre : une attaque qui suppose déjà un accès complet à la session Windows de l'utilisateur, ou à son compte Tailscale sans double authentification.

Le fonctionnement de la sécurité est décrit dans [docs/SECURITE.md](docs/SECURITE.md).
