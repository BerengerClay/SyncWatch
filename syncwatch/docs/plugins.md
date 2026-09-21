# Le Système de Plugins

SyncWatch a été conçu pour synchroniser n'importe quel site web sans que le moteur principal n'ait à connaître les sélecteurs DOM de chaque plateforme. Ce rôle est dévolu aux plugins.

## 1. Qu'est-ce qu'un Plugin SyncWatch ?

Un plugin est un simple fichier JavaScript Vanilla (ex: `youtube.js`, `tf1.js`) qui est injecté dans le contexte de la page web cible (souvent via un `<webview>` ou une balise `<script>` injectée par Tauri).

### Rôle du plugin
1. **Scraper l'état local :** Trouver l'élément `<video>`, `<audio>` ou lire l'état du DOM pour extraire le temps, l'état de pause ou la page actuelle.
2. **Appliquer l'état dicté :** Recevoir un ordre du serveur (ex: "Met toi à 10 secondes et met pause") et forcer le DOM de la page cible à obéir.
3. **Fournir l'interface utilisateur (UI) :** Envoyer à l'application React hôte un composant UI sous forme de chaîne de caractères (`sidebarCode`) afin de créer une télécommande adaptée (ex: Barre de lecture pour YouTube, Paginator pour un PDF).

## 2. La classe `BaseSyncPlugin`

Tous les plugins héritent de `SyncWatchCore` (qui gère l'IPC avec Rust/Tauri) et implémentent la machine à état dans `BaseSyncPlugin`.

Un développeur créant un plugin pour une nouvelle plateforme n'a que quelques méthodes à surcharger :

```javascript
class MyCustomPlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = "MyPlatform";
  }

  // Comment trouver l'élément vidéo
  findVideoElement() {
    return document.querySelector("#my-custom-video-player");
  }

  // Comment extraire des métadonnées (titre, statut)
  scrapeTopData() {
    const title = document.querySelector(".video-title")?.innerText;
    return { title };
  }

  // Informations très spécifiques au plugin (ex: pub en cours)
  getCustomState() {
    return {
      isAd: !!document.querySelector(".ad-overlay-visible")
    };
  }
}
```

## 3. Sandboxing et Sécurité

Le plugin opère dans une zone isolée. Il communique avec l'application principale via l'API IPC Tauri (`window.__TAURI_INTERNALS__.invoke`).
Cela signifie que si la plateforme cible change son interface et casse le scraping (le plugin renvoie une erreur), cela ne plantera jamais le client React principal ou le serveur SyncWatch. Seul ce plugin spécifique cessera de synchroniser jusqu'à sa réparation.
