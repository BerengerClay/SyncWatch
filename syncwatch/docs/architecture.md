# Architecture de SyncWatch

SyncWatch est construit autour d'une architecture distribuée classique en temps réel, mais encapsulée dans une application de bureau lourde.

## 1. Topologie Globale

Le système est composé de trois éléments distincts :
1. **Le Serveur Node.js (Socket.io) :** C'est la source de vérité. Il réside sur le web et gère la topologie des salons (`Rooms`), des sessions (`WatchSession`), et la présence (`MemberPresence`).
2. **Le Client Lourd (Tauri / Rust) :** L'application bureau elle-même, qui gère la fenêtre système, l'isolation (sandboxing) et intercepte le trafic réseau.
3. **Le Front-end (React) & Les Plugins (Vanilla JS) :** L'interface utilisateur qui se connecte au serveur et embarque un lecteur web (`iframe` ou `webview`) à l'intérieur duquel les plugins agnostiques sont injectés.

## 2. Le Serveur (La Source de Vérité)

Le serveur ne traite aucune logique spécifique aux médias. Il agit comme un routeur d'état intelligent.

### Gestion des Salles et des Sessions
- **Room :** Un rassemblement de plusieurs `Members`. Une Room peut contenir plusieurs `WatchSessions` simultanées (ex: 3 personnes regardent YouTube, 2 autres regardent un PDF dans la même room).
- **WatchSession :** Un état partagé (`media`, `features`) qui possède son propre "temps" de dernière mise à jour (`lastUpdate`) et ses propres règles de synchronisation (`rules`).

### RoomHandler (`server/src/socket/roomHandler.ts`)
Ce fichier est le contrôleur principal. Il écoute les actions du client (`SEND_ACTION`), scinde les sessions si les utilisateurs naviguent sur des URLs différentes (`handleVideoNavigation`), applique le moteur de réactions (`processReactions`), et re-diffuse le patch de l'état modifié avec un ordre de synchronisation (`SYNC_ORDER`).

## 3. Le Pont Tauri (IPC)

Afin d'isoler le lecteur web (par exemple la page YouTube) de l'interface principale React, un pont de communication est établi via Tauri. 

- Les plugins injectés dans le lecteur envoient des informations (`playback_report`) à Rust.
- Rust relaie ces informations au front-end React.
- Lorsque React veut mettre en pause la vidéo, il envoie un ordre (`playback_control`) à Rust, qui le transmet au plugin injecté.

Cette architecture garantit que l'environnement React reste propre et décorrélé du DOM externe scrapé par le plugin.
