# Bienvenue dans SyncWatch

SyncWatch est un moteur de synchronisation en temps réel de sessions de médias et de documents. 

Son objectif principal est d'être **totalement agnostique** vis-à-vis des plateformes et des types de médias synchronisés (Vidéos YouTube, PDF, Diaporamas, etc.).

## Vision du Projet

Contrairement aux solutions classiques de "Watch Party" qui sont souvent couplées au lecteur vidéo qu'elles utilisent, SyncWatch est conçu comme un **moteur mathématique pur**. Le cœur du système ne sait pas ce qu'est une vidéo, ni ce qu'est un bouton pause. Il ne connaît que des règles de synchronisation (`CONTINUOUS` ou `DISCRETE`) qu'il applique à un état partagé.

### Pourquoi cette architecture ?
- **Extensibilité :** L'ajout du support d'une nouvelle plateforme (ex: TF1+, Canal+) se fait exclusivement côté client via un plugin, sans aucune modification du code serveur.
- **Robustesse :** Le serveur Node.js est la source de vérité. L'interpolation côté client (Dead-Reckoning) garantit une fluidité visuelle même avec une latence réseau élevée.
- **Agnosticité :** En séparant la couche de transport IPC (Rust/Tauri) de l'UI (React) et des sondes (Plugins JavaScript injectés), l'application peut se transformer en un outil de synchronisation pour n'importe quelle interface web.

## Pour commencer
Utilisez le menu de navigation pour plonger dans les détails techniques des sous-systèmes :
- **Architecture :** Comprendre la relation entre le Client (React/Tauri) et le Serveur (Node.js/Socket.io).
- **Moteur de Synchronisation :** Les mathématiques derrière le *Dead-Reckoning*.
- **Système de Plugins :** Comment interagir avec l'application hôte de manière sécurisée.
