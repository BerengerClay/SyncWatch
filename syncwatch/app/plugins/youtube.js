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
      "title": { type: "IGNORED" },
    };
  }

  // Vérifie si on est devant une pub (Scanner de Shadow DOM exhaustif)
  isWatchingAd() {
    // 1. On récupère tous les lecteurs possibles (ceux dans le DOM normal)
    const players = Array.from(document.querySelectorAll(".html5-video-player"));

    // 2. On ajoute les lecteurs cachés dans les Shadow DOM des ytd-player
    document.querySelectorAll("ytd-player").forEach((ytp) => {
      if (ytp.shadowRoot) {
        const shadowPlayer = ytp.shadowRoot.querySelector(".html5-video-player");
        if (shadowPlayer) players.push(shadowPlayer);
      }
    });

    // Fonction pour vérifier si un élément est réellement visible
    const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

    // 3. On vérifie si l'un d'entre eux porte la marque de la pub (ET est visible)
    const isAnyAdActive = players.some((p) => {
      // Les classes sur le player sont généralement fiables
      if (p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting")) return true;

      // Pour les autres, on vérifie la visibilité ou le contenu
      const overlay = p.querySelector(".ytp-ad-player-overlay");
      if (isVisible(overlay)) return true;

      const badge = p.querySelector(".ad-simple-attributed-string, .ytp-ad-badge-label");
      if (isVisible(badge) && badge.innerText.trim().length > 0) return true;

      const skip = p.querySelector(".ytp-ad-skip-button, .ytp-skip-ad-button");
      if (isVisible(skip)) return true;

      const adTitle = p.querySelector(".ytp-title-link");
      if (isVisible(adTitle) && adTitle.innerText.trim().length > 0) return true;

      return false;
    });

    return isAnyAdActive;
  }

  // Trouve la vidéo locale (Plus robuste)
  findVideoElement() {
    return document.querySelector("video.html5-main-video");
  }

  // 1. LES INFOS DE LA PAGE (Le Titre)
  scrapeTopData() {
    // On cherche d'abord le titre "propre" de YouTube
    const title =
      document.querySelector("h1.ytd-watch-metadata") ||
      document.querySelector(".ytd-video-primary-info-renderer h1") ||
      document.querySelector("yt-formatted-string.ytd-video-primary-info-renderer");

    if (title && title.innerText.trim()) {
      return { title: title.innerText.trim() };
    }

    // Si on est en pub, on essaie de choper le titre de la pub dans le player
    const adTitle = document.querySelector(".ytp-title-link");
    if (adTitle && adTitle.innerText.trim()) {
      return { title: "[PUB] " + adTitle.innerText.trim() };
    }

    return {};
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
        }, state?.title || 'Chargement...'),
    ])`;
  }
}

window.SW_PLUGIN = new YouTubePlugin();
