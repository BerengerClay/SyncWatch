/**
 * SyncWatch - BaseSyncPlugin V10 (Window.top Master + Debounce Cascade + Dumb Shell)
 */
class BaseSyncPlugin extends SyncWatchCore {
  constructor() {
    super();
    this.name = 'Base Plugin';
    this.uiSent = false;
    this.videoElement = null;

    // 🧠 Mémoire du Top (Le Cerveau)
    this.aggregatedMedia = null;
    this.aggregatedFeatures = {};
    this.syncTimeout = null;
  }

  // --- 🛠️ HOOKS À SURCHARGER (Dans tf1.js, youtube.js...) ---
  scrapeTopData() { return {}; } // Ex: { tf1Title: document.querySelector('h1').innerText }
  getCustomState() { return {}; } // Ex: { isAd: true }
  
  getContainerClasses() { return 'bg-slate-900/40 border-white/5 shadow-2xl'; }
  getHeaderExtra() { return 'null'; }
  getContentTop() { return 'null'; }
  getContentBottom() { return 'null'; }
  getFooterExtra() { return 'null'; }

  // --- MOTEUR DOM VIDÉO (Pour les Iframes) ---
  findVideoElement() {
    return document.querySelector('video') || document.querySelector('audio');
  }

  getVideo() {
    const currentVideo = this.findVideoElement();

    if (!currentVideo) {
        this.videoElement = null;
        return null;
    }

    // Si on a trouvé une NOUVELLE vidéo, on lui attache nos alarmes (TRIGGER_SYNC)
    if (currentVideo !== this.videoElement) {
      this.videoElement = currentVideo;
      
      const triggerGlobalSync = () => window.top.postMessage({ type: 'SW_TRIGGER_SYNC' }, '*');
      this.videoElement.addEventListener('play', triggerGlobalSync);
      this.videoElement.addEventListener('pause', triggerGlobalSync);
      this.videoElement.addEventListener('seeked', triggerGlobalSync); // Saut manuel uniquement !
    }

    // Si la vidéo n'est plus dans le DOM, on nettoie
    if (this.videoElement && !document.body.contains(this.videoElement)) {
      this.videoElement = null;
    }

    return this.videoElement;
  }

  getBaseState() {
    const v = this.getVideo();
    if (!v) return null;
    return {
      time: v.currentTime,
      paused: v.paused,
      duration: v.duration || 0
    };
  }

  applyBaseState(mediaState) {
    const v = this.getVideo();
    if (!v) return;

    if (Math.abs(v.currentTime - mediaState.time) > 2) {
      v.currentTime = mediaState.time;
    }
    
    if (v.paused !== mediaState.paused) {
      mediaState.paused ? v.pause() : v.play().catch(() => {});
    }
  }

  // --- 🌐 LE CŒUR DU RÉSEAU (Top vs Iframe) ---
  init() {
    if (window.location.href.startsWith('about:')) return; 

    if (window === window.top) {
        this.initTopMaster(); // Le Patron
    } else {
        this.initIframeSensor(); // Les Employés
    }
  }

  // 👑 LE PATRON (window.top)
  initTopMaster() {
    if (window.swInitDone) return;
    window.swInitDone = true;

    // 🚨 LA PROCÉDURE DE RASSEMBLEMENT (Debounce)
    const forceSync = () => {
        // 1. On vide la mémoire vidéo ! (Si l'iframe est morte, ça restera null -> IDLE)
        this.aggregatedMedia = this.getBaseState();

        // 2. On demande à toutes les iframes de parler MAINTENANT
        document.querySelectorAll('iframe').forEach(f => {
            f.contentWindow?.postMessage({ type: 'SW_FORCE_UPDATE' }, '*');
        });

        // 3. Le Top note ses propres infos (Le Titre)
        const topData = this.scrapeTopData();
        this.aggregatedFeatures = { ...this.aggregatedFeatures, ...topData };

        // 4. On attend 20ms que tout le monde réponde, puis on envoie le paquet final
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        this.syncTimeout = setTimeout(() => {
            const payload = {
                media: this.aggregatedMedia,
                features: this.aggregatedFeatures,
                sidebarCode: !this.uiSent ? this.getSidebarCode() : null // Plan envoyé 1 seule fois
            };
            
            this.sendReportToApp(payload).then(() => {
                if (payload.sidebarCode) this.uiSent = true;
            });
        }, 20);
    };

    // 👂 Écoute des Employés
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        
        if (e.data.type === 'SW_INFO') {
            // Un employé donne ses infos : on les note !
            if (e.data.media !== undefined && e.data.media !== null) this.aggregatedMedia = e.data.media;
            if (e.data.features) this.aggregatedFeatures = { ...this.aggregatedFeatures, ...e.data.features };
        }
        
        if (e.data.type === 'SW_TRIGGER_SYNC') {
            // Un employé a subi une action humaine : Alarme globale !
            forceSync();
        }
    });

    // 📡 Ordres venant de Tauri (React)
    this.listenToApp((cmd, data) => {
        if (cmd === 'APPLY_STATE') {

            if (data.media) {
                this.applyBaseState(data.media);
            }
            // Le Top ne touche pas la vidéo, il relaie l'ordre aux iframes
            document.querySelectorAll('iframe').forEach(f => {
                f.contentWindow?.postMessage({ type: 'SW_APPLY_STATE', payload: data }, '*');
            });
        }
        forceSync(); // On force une mise à jour pour que React voit que l'ordre est passé
    });

    // ☠️ LE TESTAMENT (Quand la page se rafraîchit ou se ferme)
    window.addEventListener('pagehide', () => {
        // 1. On annule tout envoi qui était prévu dans les 20ms
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        
        // 2. On envoie un paquet de la mort (media: null force le mode IDLE)
        this.sendReportToApp({
            media: null, 
            features: { title: 'Navigation en cours...' }, // Optionnel, pour faire joli
            sidebarCode: null
        }).catch(() => {}); // On met un catch silencieux car la page est en train de mourir
    });

    // ⏱️ Routine de sécurité (au cas où rien ne bouge, garantit la détection de l'IDLE)
    setInterval(() => forceSync(), 1000);

    forceSync();

  }

  // 🎥 LES EMPLOYÉS (Iframes)
  initIframeSensor() {
    const sendToTop = () => {
        window.top.postMessage({
            type: 'SW_INFO',
            media: this.getBaseState(),
            features: this.getCustomState()
        }, '*');
    };

    // 👂 Écoute du Patron ou de Tauri
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        
        if (e.data.type === 'SW_FORCE_UPDATE') {
            sendToTop(); // Le patron exige un rapport immédiat
        }
        
        if (e.data.type === 'SW_APPLY_STATE') {
            // Ordre de Play/Pause venant de React
            if (e.data.payload && e.data.payload.media) {
                this.applyBaseState(e.data.payload.media);
            }
        }
    });

    // 🖱️ Clic humain n'importe où dans l'iframe
    // window.addEventListener('click', () => {
    //     window.top.postMessage({ type: 'SW_TRIGGER_SYNC' }, '*');
    // });

    // ⏱️ Routine locale (optionnelle, le Top interroge déjà toutes les secondes)
    // setInterval(sendToTop, 1000);

    sendToTop();
  }


  // --- 🎨 GÉNÉRATEURS DE L'INTERFACE REACT (Côté Web) ---

  renderBadgeCode(pluginName, headerExtra) {
    return `React.createElement('div', { key: 'badge', className: 'flex items-center gap-3 mb-6' }, [
      React.createElement('div', { key: 'dot', className: 'w-1.5 h-1.5 rounded-full ' + (isPaused ? 'bg-white/10' : 'bg-emerald-500 animate-pulse') }),
      React.createElement('span', { key: 'name', className: 'text-[10px] font-black text-white/20 uppercase tracking-[0.4em]' }, "${pluginName}"),
      ${headerExtra}
    ])`;
  }

  renderTimerCode() {
    return `React.createElement('div', { key: 'timer-container', className: 'flex flex-col items-center gap-2 mt-4' }, [
        React.createElement('span', { 
            key: 'current-time',
            className: 'font-mono font-black text-white tabular-nums text-center',
            style: { fontSize: 'clamp(3rem, 12vw, 4.5rem)' }
        }, formatTime(localTime)),
        React.createElement('span', { key: 'total-duration', className: 'text-[11px] font-black text-white/10 uppercase tracking-[0.3em]' }, 'Total: ' + formatTime(duration))
    ])`;
  }

  renderPlayPauseButtonCode() {
    return `React.createElement('button', {
        key: 'play-pause-btn',
        onClick: () => {
            props.sendControl('APPLY_STATE', { media: { paused: !isPaused } });
        },
        className: 'group relative flex items-center justify-center w-20 h-20 rounded-full bg-slate-800/40 backdrop-blur-xl border border-white/10 hover:border-emerald-500/50 transition-all duration-700 shadow-[0_0_40px_rgba(0,0,0,0.3)] hover:shadow-emerald-500/20'
    }, [
        React.createElement('div', { key: 'ring', className: 'absolute -inset-2 rounded-full border border-emerald-500/0 group-hover:border-emerald-500/10 transition-all duration-1000 scale-90 group-hover:scale-100' }),
        React.createElement('div', { key: 'glow', className: 'absolute inset-0 rounded-full bg-emerald-500/0 group-hover:bg-emerald-500/5 blur-2xl transition-all duration-700' }),
        isPaused 
            ? React.createElement('svg', { key: 'icon-play', className: 'w-8 h-8 text-white group-hover:text-emerald-400 fill-current translate-x-0.5 transition-all duration-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]', viewBox: '0 0 24 24' }, [
                React.createElement('path', { key: 'p', d: 'M5 3l14 9-14 9V3z' })
            ])
            : React.createElement('svg', { key: 'icon-pause', className: 'w-8 h-8 text-white group-hover:text-emerald-400 fill-current transition-all duration-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]', viewBox: '0 0 24 24' }, [
                React.createElement('rect', { key: 'r1', x: '6', y: '4', width: '4', height: '16', rx: '1.5' }),
                React.createElement('rect', { key: 'r2', x: '14', y: '4', width: '4', height: '16', rx: '1.5' })
            ])
    ])`;
  }

  renderSliderCode() {
    return `React.createElement('div', { key: 'slider-premium', className: 'relative w-full group/slider flex items-center mt-10 max-w-[300px] h-6 cursor-pointer' }, [
        React.createElement('div', { key: 'track-bg', className: 'absolute h-1 w-full bg-white/5 rounded-full overflow-hidden' }),
        React.createElement('div', { 
            key: 'track-fill',
            className: 'absolute h-1 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)]', 
            style: { width: progress + '%' } 
        }),
        React.createElement('div', { 
            key: 'thumb',
            className: 'absolute w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)] border-2 border-emerald-500 transition-transform duration-200 group-hover/slider:scale-125 group-active/slider:scale-150',
            style: { left: 'calc(' + progress + '% - 7px)', zIndex: 20 }
        }),
        React.createElement('input', {
            key: 'native-input',
            type: 'range',
            min: 0, max: duration || 100, value: localTime || 0, step: 0.1,
            onInput: (e) => { setIsDragging(true); setLocalTime(parseFloat(e.target.value)); },
            onChange: (e) => {
                const val = parseFloat(e.target.value);
                props.sendControl('APPLY_STATE', { media: { time: val } });
                setTimeout(() => setIsDragging(false), 600);
            },
            className: 'absolute w-full h-full appearance-none bg-transparent cursor-pointer z-30 opacity-0'
        })
    ])`;
  }

  // --- L'INTERFACE UNIFIÉE DE RÉACT (L'Arbre Conditionnel) ---
  getSidebarCode() {
    const pluginName = this.name;
    const classes = this.getContainerClasses();
    
    const badge = this.renderBadgeCode(pluginName, this.getHeaderExtra());
    const timer = this.renderTimerCode();
    const playBtn = this.renderPlayPauseButtonCode();
    const slider = this.renderSliderCode();

    const contentTop = this.getContentTop();
    const contentBottom = this.getContentBottom();
    const footerExtra = this.getFooterExtra();

    return `(props) => {
      const { media, features = {} } = props;
      
      // 🧠 L'Intelligence d'affichage
      const isIdle = !media;
      const isAd = !!features.isAd;
      const isWatch = media && !isAd;

      const time = media?.time || 0;
      const duration = media?.duration || 0;
      const isPaused = media ? media.paused : true;

      // 🎣 HOOKS (Appelés inconditionnellement)
      const [isDragging, setIsDragging] = React.useState(false);
      const [localTime, setLocalTime] = React.useState(time);

      React.useEffect(() => {
        if (!media) return;
        if (!isDragging) {
            setLocalTime(prev => Math.abs(prev - time) > 0 ? time : prev);
        }
      }, [time, isDragging, media]);

      React.useEffect(() => {
        if (!media) return;
        let interval;
        if (!isPaused && !isDragging) {
            interval = setInterval(() => setLocalTime(prev => prev + 0.1), 100);
        }
        return () => clearInterval(interval);
      }, [isPaused, isDragging, media]);

      const formatTime = (s) => {
        if (!s || isNaN(s)) return "00:00";
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return (h > 0 ? h + ':' : '') + m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0');
      };

      const progress = duration > 0 ? (localTime / duration) * 100 : 0;

      // 🌳 L'ARBRE UNIQUE
      return React.createElement('div', { 
        className: 'flex flex-col items-center justify-center w-full h-[85vh] p-10 gap-8 animate-in fade-in duration-500 ' + '${classes}'
      }, [
        // TOUJOURS LÀ
        ${badge},
        ${contentTop},

        // ETAT 1 : IDLE
        isIdle ? React.createElement('div', { key: 'idle-box', className: 'flex flex-col items-center gap-4 opacity-50 my-10 animate-in fade-in' }, [
            React.createElement('svg', { key: 'icon', className: 'w-16 h-16 text-white/20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2' }, [
                React.createElement('circle', { key: 'c', cx: '11', cy: '11', r: '8' }),
                React.createElement('line', { key: 'l', x1: '21', y1: '21', x2: '16.65', y2: '16.65' })
            ]),
            React.createElement('span', { key: 'txt', className: 'text-xs font-bold text-white uppercase tracking-widest animate-pulse mt-4 text-center' }, 'En attente de vidéo...')
        ]) : null,

        // ETAT 2 : PUBLICITÉ
        isAd ? React.createElement('div', { key: 'ad-box', className: 'my-10 animate-pulse animate-in fade-in' }, [
            React.createElement('span', { className: 'text-xl font-black text-red-500 tracking-widest' }, 'PUBLICITÉ EN COURS')
        ]) : null,

        // ETAT 3 : LECTURE
        isWatch ? React.createElement('div', { key: 'watch-box', className: 'flex flex-col items-center w-full gap-4 animate-in fade-in zoom-in-95' }, [
            ${timer},
            ${playBtn},
            ${slider}
        ]) : null,

        // TOUJOURS LÀ
        ${contentBottom},
        ${footerExtra}
      ]);
    }`;
  }
}