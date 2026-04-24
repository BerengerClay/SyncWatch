/**
 * SyncWatch - Core V8 (Couche Réseau Tauri)
 */
class SyncWatchCore {
  constructor() {
    // On vérifie si on tourne bien dans Tauri et pas dans un navigateur classique
    this.isTauriAvailable = !!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);
  }

  // Envoi vers Rust (Radar)
  sendReportToApp(payload) {
    if (this.isTauriAvailable) {
      console.log("[SyncWatch] 📡 Envoi du rapport :", payload);
      return window.__TAURI_INTERNALS__.invoke('playback_report', { payload })
        .catch(() => console.warn("[SyncWatch] Échec de l'envoi du rapport"));
    }
    return Promise.resolve();
  }

  // Écoute de Rust (Télécommande)
  listenToApp(callback) {
    window.syncWatchControl = callback;
  }
}