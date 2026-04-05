class TF1Plugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'TF1+';
  }

  isTargetIframe() {
    if (window === window.top) return false; 
    return window.location.hostname.includes('prod-player.tf1.fr');
  }

  getVideo() {
    if (!this.isTargetIframe()) return null;
    return document.querySelector('#ntrs-video-media');
  }

  getContainerClasses() {
    return 'bg-blue-950/40 border-blue-500/20 shadow-[0_0_40px_rgba(30,58,138,0.3)]';
  }

  getCustomState() {
    const state = {};
    
    if (window === window.top) {
        const el = document.querySelector('h1');
        if (el) state.tf1Title = el.innerText.trim();
    }
    
    if (this.isTargetIframe()) {
        const player = document.querySelector('ntrs-player');
        if (player) state.isAd = player.classList.contains('is-ad');
    }
    
    return state;
  }

  getContentTop() {
    return `React.createElement('div', { className: 'flex flex-col items-center gap-4 w-full relative' }, [
         // --- ALERTE PUBLICITÉ ---
        features.isAd ? React.createElement('div', { 
            className: 'w-full py-2 bg-gradient-to-r from-red-600/80 via-rose-500/80 to-red-600/80 border border-red-400/50 rounded-xl text-center shadow-[0_0_20px_rgba(220,38,38,0.4)] mb-2' 
        }, React.createElement('span', { className: 'text-[10px] font-black text-white uppercase tracking-[0.3em]' }, 'Publicité en cours')) : null,

        // --- TITRE ---
        React.createElement('h1', { 
            className: 'text-center font-bold text-white tracking-tight leading-tight ' + (features.isAd ? 'opacity-50' : ''),
            style: { fontSize: 'clamp(1.5rem, 6vw, 1.8rem)', display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' }
        }, features.tf1Title || 'Chargement...'),
    ])`;
  }
}

window.SW_PLUGIN = new TF1Plugin();
