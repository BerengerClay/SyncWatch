class YouTubePlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'YouTube';
  }

  getCustomState() {
    const title = document.querySelector('h1.ytd-watch-metadata') || 
                  document.querySelector('.ytd-video-primary-info-renderer h1');
    return title ? { ytTitle: title.innerText.trim() } : {};
  }

  getContainerClasses() {
    return 'bg-red-950/30 border-red-500/10 shadow-[0_0_50px_rgba(220,38,38,0.1)]';
  }


  getContentTop() {
    return `React.createElement('div', { className: 'flex flex-col items-center gap-4 w-full' }, [
        React.createElement('h1', { 
            className: 'text-center font-bold text-white tracking-tight leading-tight',
            style: { fontSize: 'clamp(1.5rem, 6vw, 1.8rem)', display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }
        }, features.ytTitle || 'Chargement...'),

    ])`;
  }
}

window.SW_PLUGIN = new YouTubePlugin();