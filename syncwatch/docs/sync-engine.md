# Moteur de Synchronisation (SyncEngine)

Le cœur de l'innovation de SyncWatch réside dans la manière dont il gère la synchronisation du temps dans un environnement distribué et sujet à la latence.

## 1. Le Problème de Latence

Si le serveur envoie simplement "Le temps est à 10.5 secondes" au client, au moment où le message arrive, la vidéo devrait déjà être à 10.6 secondes. Pire, bombarder le serveur de mises à jour de temps (toutes les 100ms) saturerait le réseau.

## 2. Le "Dead-Reckoning" (Extrapolation)

Plutôt que d'envoyer l'état exact en permanence, SyncWatch envoie des **vecteurs d'état**. 
Un vecteur contient :
- Une valeur de départ (`time: 10.0`)
- Une vitesse (`playbackRate: 1.0`)
- Un indicateur d'activité (`paused: false`)
- Un horodatage absolu (Timestamp du serveur : `ts`)

**Côté Client (`app/src/components/SyncEngine.tsx`) :**
Le client calcule en temps réel où la vidéo *devrait* être, en mesurant la différence entre l'horloge système actuelle et l'horodatage `ts` du serveur.
Si la vidéo locale dérive trop (ex: > 2 secondes de différence avec l'estimation locale du serveur), un correctif brutal est appliqué (`applyBaseState`). Sinon, la lecture continue localement sans interruption.

## 3. Les Règles Agnostiques (SyncRules)

Le moteur ne connaît pas les vidéos. Il connaît les `SyncRules`.

### `CONTINUOUS`
Une valeur continue est extrapolée dans le temps. 
Exemple : `media.time`. 
Si la règle dit que `activeIfKey: "media.paused"` (avec inversion) et `speedKey: "media.playbackRate"`, alors le serveur et le client savent calculer la valeur actuelle par :
`Valeur_Estimée = Valeur_Initiale + (Maintenant - Timestamp_Initial) * Vitesse`

### `DISCRETE`
Une valeur discrète ne change que lorsqu'un événement réseau est reçu. Elle n'a pas de "vitesse".
Exemple : `media.paused`, `document.pageNumber`, `features.isAd`.

## 4. Le Moteur de Réactions (`processReactions`)

Le serveur possède une logique d'arbitrage automatisée (`server/src/services/syncEngine.ts`). 
Un plugin peut définir qu'une variable discrète (ex: `features.isAd`) doit forcer une autre variable en pause. 

```json
"features.isAd": {
  "type": "DISCRETE",
  "collective": true,
  "reactions": {
    "true": { "media.paused": true },
    "false": { "media.paused": false }
  }
}
```
Grâce à cela, si l'attribut `isAd` d'un seul membre de la session devient `true`, le serveur force le paramètre `media.paused` à `true` pour *tout le monde*, sans que l'application React n'ait besoin de comprendre ce qu'est une publicité.
