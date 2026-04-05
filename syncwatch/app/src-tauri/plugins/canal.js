class CanalPlusPlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'Canal+';
  }

  // 1. Un design très sombre et premium pour Canal+
  getContainerClasses() { 
    return 'bg-black/95 border-white/10 shadow-[0_0_60px_rgba(255,255,255,0.05)]'; 
  }

  // 🔥 RÉCUPÉRATION PRÉCISE DU LECTEUR (Target: #oneplayer-container-1)
  getVideo() {
    // Le premier <video> est souvent une pub ou un overlay. Le second dans OnePlayer est le bon.
    return document.querySelector('#oneplayer-container-1 video') || document.querySelector('video');
  }

  // 2. Récupération des infos du film / série
  getCustomState() {
    const state = {};

    if (window === window.top) {
        const el = document.querySelector('head > title');
        if (el) state.title = el.innerText.trim();
    }
    
    return state;
  }

  // 3. Affichage du titre personnalisé
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
            if (window.__TAURI_INTERNALS__?.invoke) {
                window.__TAURI_INTERNALS__.invoke('playback_control', { 
                    command: 'ADD_TO_PLAYLIST', 
                    data: {} 
                });
            }
        },
        className: 'mt-2 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/5 rounded-full text-[10px] font-black text-white uppercase tracking-[0.2em] transition-all duration-300 backdrop-blur-md'
      }, 'Ajouter à ma playlist')
    `;
  }

  // 🔥 On surcharge init pour écouter la commande personnalisée
  init() {
    super.init();
    const oldControl = window.syncWatchControl;
    window.syncWatchControl = (cmd, data) => {
        if (oldControl) oldControl(cmd, data);
        if (cmd === 'ADD_TO_PLAYLIST') {
            console.log("[SyncWatch] ➕ Ajout à la playlist Canal+...");
            const btn = document.querySelector('button[aria-label*="playlist"]') 
                     || document.querySelector('.detailV5__actionLayout button')
                     || document.querySelector('li:nth-child(2) > div > button'); // Le sélecteur du user en dernier recours
            if (btn) btn.click();
        }
    };
  }

  // 🔥 OPTIMISATION : On n'envoie un rapport que si on est utile (Top Frame ou Player Frame)
  report() {
    const hasVideo = !!this.getVideo();
    if (window === window.top || hasVideo) {
      super.report();
    }
    // Les autres iframes (pubs, trackers) se taisent pour éviter le clignotement.
  }

  // // 4. Synchronisation simple sans iframe
  // applyBaseState(mediaState) {
  //   const v = this.getVideo();
  //   if (!v) return;

  //   if (Math.abs(v.currentTime - mediaState.time) > 2) v.currentTime = mediaState.time;
    
  //   if (v.paused !== mediaState.paused) {
  //     if (mediaState.paused) v.pause();
  //     else v.play().catch(() => {
  //         const clickTarget = document.querySelector('#oneplayer-container-1') || v;
  //         if (clickTarget && typeof clickTarget.click === 'function') clickTarget.click();
  //     });
  //   }
  // }
}

// On injecte le plugin pour Canal+
window.SW_PLUGIN = new CanalPlusPlugin();