class YouTubePlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'YouTube';
  }

  getCurrentUrl() {
    if (this.videoElement) {
      return this.videoElement.src.replace('blob:', '');
    }
    return null;
  }


  // Vérifie si on est devant une pub
  isWatchingAd() {
    const player = document.querySelector('#movie_player');
    return player && player.classList.contains('ad-showing');
  }

  // Trouve la vidéo locale
  findVideoElement() {
    // const player = document.querySelector('#movie_player');
    const video = document.querySelector('#movie_player video');
    if (!video) return null;

    // if (!player || !video) return null;
    // if (!video.src || video.src === '') return null;
    // if (player.classList.contains('unstarted-mode')) return null;
    
    return video.src !== '' ? video : null;
  }

  // 1. LES INFOS DE LA PAGE (Le Titre)
  scrapeTopData() {
    const title = document.querySelector('h1.ytd-watch-metadata') || 
                  document.querySelector('.ytd-video-primary-info-renderer h1');
    return title ? { ytTitle: title.innerText.trim() } : {};
  }

  // 2. L'ÉTAT SPÉCIFIQUE AU LECTEUR (La Pub)
  getCustomState() {
    return {
        // La magie est ici : ça déclenche l'écran rouge du BasePlugin !
        isAd: !!this.isWatchingAd() 
    };
  }

  // --- INTERFACE ---
  getContainerClasses() {
    return 'bg-red-950/30 border-red-500/10 shadow-[0_0_50px_rgba(220,38,38,0.1)]';
  }

  getContentTop() {
    return `React.createElement('div', { key: 'yt-top', className: 'flex flex-col items-center gap-4 w-full' }, [
        React.createElement('h1', { 
            key: 'yt-title',
            className: 'text-center font-bold text-white tracking-tight leading-tight',
            style: { fontSize: 'clamp(1.5rem, 6vw, 1.8rem)', display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }
        }, features?.ytTitle || 'Chargement...'),
    ])`;
  }
}

window.SW_PLUGIN = new YouTubePlugin();