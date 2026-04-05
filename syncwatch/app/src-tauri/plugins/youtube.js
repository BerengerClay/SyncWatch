class YouTubePlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'YouTube';
    this.currentTitle = 'Chargement...';
  }

  // Récupère le titre via les sélecteurs spécifiques de YouTube
  getVideoTitle() {
    const title = document.querySelector('h1.ytd-watch-metadata') || 
                    document.querySelector('.ytd-video-primary-info-renderer h1');
    return title ? title.innerText.trim() : 'Vidéo inconnue';
  }

  getContainerClasses() {
    return 'bg-red-950/30 border-red-500/10 shadow-[0_0_50px_rgba(220,38,38,0.1)]';
  }

  /**
   * On surcharge la fonction report pour surveiller le changement de titre
   */
  report() {
    const title = this.getVideoTitle();

    // Si le titre change (changement de vidéo sans recharger la page)
    if (title !== this.currentTitle && title !== 'Vidéo inconnue') {
      this.currentTitle = title;
      this.uiSent = false; // 🔄 Force React à re-compiler la Sidebar avec le nouveau titre
    }

    super.report();
  }

  /**
   * On utilise le "Badge" du header pour afficher le titre
   */
  getContentTop() {
    // Sécurisation du titre pour l'injecter dans du JS
    const encodedTitle = JSON.stringify(this.currentTitle);
    
    return `React.createElement('div', { 
        className: 'max-w-[200px] truncate px-3 py-1.5 bg-red-500/10 border border-red-500/10 rounded-lg text-[9px] font-bold text-red-400 capitalize tracking-tight' 
    }, ${encodedTitle})`;
  }
}

window.SW_PLUGIN = new YouTubePlugin();