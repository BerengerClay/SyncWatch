class YouTubePlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = "YouTube";
  }

  isPlayerActive() {
    // Le lecteur principal est toujours dans #movie_player.
    // L'astuce ultime : quand YouTube ferme une vidéo (miniplayer fermé ou navigation),
    // il vide l'attribut "src" de la balise vidéo.
    const video = document.querySelector(
      "#movie_player video.html5-main-video",
    );
    return video !== null && !!video.src && video.src !== "";
  }

  getCurrentUrl() {
    if (this.videoElement && this.isPlayerActive()) {
      // Si on est sur une vraie page vidéo, on met à jour le cache.
      // Sinon (miniplayer sur l'accueil), on garde l'URL en cache.
      if (
        window.location.href.includes("watch?v=") ||
        window.location.href.includes("/shorts/")
      ) {
        this.url = window.location.href;
      }
      return this.url;
    }
    return window.location.href;
  }

  getSyncRules() {
    return {
      ...super.getSyncRules(),
      playbackRate: { type: "DISCRETE", ignoreIfKey: "isAd" },
      title: { type: "IGNORED" },
      owner: { type: "IGNORED" },
      adTitle: { type: "IGNORED" },
    };
  }

  // Scanner pur du DOM (sans effets de bord)
  isWatchingAdDOM() {
    const player = document.getElementById("movie_player");
    if (!player) return false;

    // YouTube ajoute systématiquement ces classes au lecteur principal
    if (
      player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting")
    ) {
      return true;
    }

    // Fallback au cas où YouTube change ses classes de base (basé sur l'UI de pub)
    const adElement = player.querySelector(
      ".ytp-ad-player-overlay, .ytp-ad-badge-label, .ytp-skip-ad-button",
    );
    return adElement !== null && adElement.offsetWidth > 0;
  }

  // Vérifie si on est devant une pub et applique les effets de bord (Skip, x16)
  isWatchingAd() {
    const isAnyAdActive = this.isWatchingAdDOM();
    const video = document.querySelector(
      "#movie_player video.html5-main-video",
    );

    if (isAnyAdActive && video) {
      // --- AUTO-SKIP ET ACCÉLÉRATION DE LA PUB ---
      if (!this._adOriginalRate) {
        this._adOriginalRate = video.playbackRate;

        // 🔴 CRITIQUE: Boucle ultra-rapide (50ms) pour surveiller la fin de la pub.
        if (this._adFastLoop) clearInterval(this._adFastLoop);
        this._adFastLoop = setInterval(() => {
          // Détection de fin de pub
          if (!this.isWatchingAdDOM() && this._adOriginalRate) {
            // La pub vient de se terminer ! Restauration immédiate.
            video.playbackRate = this._adOriginalRate;
            this._adOriginalRate = null;
            clearInterval(this._adFastLoop);
          }
        }, 50);
      }

      if (video.playbackRate !== 16.0) {
        video.playbackRate = 16.0;
      }
    }

    return isAnyAdActive;
  }

  getBaseState() {
    const state = super.getBaseState();
    // Masque la vitesse x16 au moteur de synchronisation pour éviter de polluer les autres utilisateurs
    // pendant la pub ou lors de la tick de transition où la pub se termine.
    if (state && this._adOriginalRate) {
      state.playbackRate = this._adOriginalRate;
    }
    return state;
  }

  // Trouve la vidéo locale (Plus robuste)
  findVideoElement() {
    if (!this.isPlayerActive()) return null;

    // #movie_player est le conteneur principal du lecteur, actif à la fois
    // sur la page /watch et dans le miniplayer.
    // Cela nous permet d'ignorer les lecteurs fantômes ou d'aperçu (ex: #inline-preview-player).
    return document.querySelector("#movie_player video.html5-main-video");
  }

  showTitle() {
    if (!this.isPlayerActive()) return null;

    const isVideoPage = window.location.href.includes("watch?v=");
    if (this.videoElement && isVideoPage) {
      const titleEl = document.querySelector("h1.ytd-watch-metadata");
      if (titleEl && titleEl.innerText.trim()) {
        this.title = titleEl.innerText.trim();
      }
      return this.title;
    } else if (this.videoElement && this.title) {
      return this.title;
    }
    return null;
  }

  showSubtitle() {
    if (!this.isPlayerActive()) return null;

    const isVideoPage = window.location.href.includes("watch?v=");
    if (this.videoElement && isVideoPage) {
      const ownerEl = document.querySelector(
        "ytd-watch-metadata .ytd-channel-name a",
      );
      if (ownerEl && ownerEl.innerText.trim()) {
        this.subtitle = ownerEl.innerText.trim();
      }
      return this.subtitle;
    } else if (this.videoElement && this.subtitle) {
      return this.subtitle;
    }
    return null;
  }

  // 2. L'ÉTAT SPÉCIFIQUE AU LECTEUR (La Pub)
  getCustomState() {
    return {
      isAd: this.isWatchingAd(),
    };
  }

  // --- INTERFACE ---
  getContainerClasses() {
    return "bg-red-950/30 border-red-500/10 shadow-[0_0_50px_rgba(220,38,38,0.1)]";
  }

  getContentTop() {
    return `React.createElement('div', { key: 'yt-top', className: 'flex flex-col items-center gap-4 w-full' }, [
        React.createElement('h1', { 
            key: 'yt-title',
            className: 'text-center font-bold text-white tracking-tight leading-tight',
            style: { fontSize: 'clamp(1.5rem, 6vw, 1.8rem)', display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }
        }, state?.isIdle ? 'Navigation...' : (state?.uiTitle)),
        (!state?.isIdle && state?.uiSubtitle) ? React.createElement('h2', {
            key: 'yt-subtitle',
            className: 'text-[11px] font-black text-red-400 uppercase tracking-widest'
        }, state.uiSubtitle) : null,
    ])`;
  }
}

window.SW_PLUGIN = new YouTubePlugin();
