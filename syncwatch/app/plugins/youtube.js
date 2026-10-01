class YouTubePlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = "YouTube";
  }

  getCurrentUrl() {
    try {
      const u = new URL(window.location.href);
      const v = u.searchParams.get("v");
      if (v) {
        return `https://www.youtube.com/watch?v=${v}`;
      }
      const shorts = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shorts) {
        return `https://www.youtube.com/shorts/${shorts[1]}`;
      }
      return `${u.origin}${u.pathname}`;
    } catch {
      return window.location.href;
    }
  }

  getSyncRules() {
    return {
      ...super.getSyncRules(),
      title: { type: "IGNORED" },
    };
  }

  // Vérifie si on est devant une pub (Scanner de Shadow DOM exhaustif)
  isWatchingAd() {
    // 1. On récupère tous les lecteurs possibles (ceux dans le DOM normal)
    const players = Array.from(
      document.querySelectorAll(".html5-video-player"),
    );

    // 2. On ajoute les lecteurs cachés dans les Shadow DOM des ytd-player
    document.querySelectorAll("ytd-player").forEach((ytp) => {
      if (ytp.shadowRoot) {
        const shadowPlayer = ytp.shadowRoot.querySelector(
          ".html5-video-player",
        );
        if (shadowPlayer) players.push(shadowPlayer);
      }
    });

    // Fonction pour vérifier si un élément est réellement visible
    const isVisible = (el) =>
      !!(
        el &&
        (el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      );

    // 3. On vérifie si l'un d'entre eux porte la marque de la pub (ET est visible)
    const isAnyAdActive = players.some((p) => {
      // Les classes sur le player sont généralement fiables
      if (
        p.classList.contains("ad-showing") ||
        p.classList.contains("ad-interrupting")
      )
        return true;

      // Pour les autres, on vérifie la visibilité ou le contenu
      const overlay = p.querySelector(".ytp-ad-player-overlay");
      if (isVisible(overlay)) return true;

      const badge = p.querySelector(
        ".ad-simple-attributed-string, .ytp-ad-badge-label",
      );
      if (isVisible(badge) && badge.innerText.trim().length > 0) return true;

      const skip = p.querySelector(".ytp-ad-skip-button, .ytp-skip-ad-button");
      if (isVisible(skip)) return true;

      const adTitle = p.querySelector(".ytp-title-link");
      if (isVisible(adTitle) && adTitle.innerText.trim().length > 0)
        return true;

      return false;
    });

    return isAnyAdActive;
  }

  // Trouve la vidéo locale (Plus robuste)
  findVideoElement() {
    return document.querySelector("video.html5-main-video");
  }

  scrapeTopData() {
    const data = {};

    // Titre de la vidéo (reste dans le DOM même pendant la pub)
    const titleEl =
      document.querySelector("h1.ytd-watch-metadata") ||
      document.querySelector(".ytd-video-primary-info-renderer h1") ||
      document.querySelector("yt-formatted-string.ytd-video-primary-info-renderer") ||
      document.querySelector("#title > h1");
    if (titleEl && titleEl.innerText.trim()) {
      data.title = titleEl.innerText.trim();
    }

    // Nom de la chaîne
    const ownerEl = document.querySelector("#owner-name a") || document.querySelector("#channel-name a") || document.querySelector(".ytd-channel-name a");
    if (ownerEl && ownerEl.innerText.trim()) {
      data.owner = ownerEl.innerText.trim();
    }

    return data;
  }

  showTitle() {
    const isVideo = window.location.pathname.includes('/watch') || window.location.pathname.includes('/shorts/');
    if (!isVideo) return null;

    const data = this.scrapeTopData();
    return data.title || "Vidéo YouTube";
  }

  showSubtitle() {
    const isVideo = window.location.pathname.includes('/watch') || window.location.pathname.includes('/shorts/');
    if (!isVideo) return null;

    const data = this.scrapeTopData();
    return data.owner || "YouTube";
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
        }, state?.uiTitle || 'Chargement...'),
        state?.uiSubtitle ? React.createElement('h2', {
            key: 'yt-subtitle',
            className: 'text-[11px] font-black text-red-400 uppercase tracking-widest'
        }, state.uiSubtitle) : null,
    ])`;
  }
}

window.SW_PLUGIN = new YouTubePlugin();
