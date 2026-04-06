class CanalPlusPlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'Canal+';
  }

  getContainerClasses() { 
    return 'bg-black/95 border-white/10 shadow-[0_0_60px_rgba(255,255,255,0.05)]'; 
  }

  findVideoElement() {
    return document.querySelector('[id^="oneplayer-container"] video');
  }

  getCustomState() {
    const state = {};
    if (window === window.top) {
        const el = document.querySelector('head > title');
        if (el) state.title = el.innerText.trim();
    }
    return state;
  }

  getContentTop() {
    return `
      React.createElement('div', { key: 'canal-info', className: 'flex flex-col items-center gap-2 mt-4 text-center px-6' }, [
        React.createElement('h2', { 
            key: 'c-title', 
            className: 'font-black text-white tracking-widest uppercase italic leading-tight',
            style: { 
                fontSize: 'clamp(1.2rem, 5vw, 1.6rem)',
                display: '-webkit-box',
                WebkitLineClamp: '3',
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
            }
        }, features.title || 'Programme Canal+')
      ])
    `;
  }

  getContentBottom() {
    return `
      React.createElement('button', {
        key: 'playlist-btn',
        onClick: () => {
            props.sendControl('ADD_TO_PLAYLIST', {}); // ✅ Parfait, propre !
        },
        className: 'mt-2 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/5 rounded-full text-[10px] font-black text-white uppercase tracking-[0.2em] transition-all duration-300 backdrop-blur-md'
      }, 'Ajouter à ma playlist')
    `;
  }

  // 🔥 LA NOUVELLE LOGIQUE PROPRE
  handleCustomCommand(cmd, data) {
    if (cmd === 'ADD_TO_PLAYLIST') {
        console.log("[SyncWatch] ➕ Ajout à la playlist Canal+...");
        const btn = document.querySelector('button[aria-label*="playlist"]') 
                 || document.querySelector('.detailV5__actionLayout button')
                 || document.querySelector('li:nth-child(2) > div > button');
        if (btn) btn.click();
    }
  }

  report() {
    const hasVideo = !!this.getVideo();
    if (window === window.top || hasVideo) {
      super.report();
    }
  }
}

window.SW_PLUGIN = new CanalPlusPlugin();