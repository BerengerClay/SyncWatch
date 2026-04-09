/**
 * SyncWatch - BaseSyncPlugin V11 (Truly Agnostic + Premium UI + Latency Compensation)
 */
class BaseSyncPlugin extends SyncWatchCore {
  constructor() {
    super();
    this.name = 'Base Plugin';
    this.uiSent = false;
    this.videoElement = null;
    this.aggregatedMedia = null;
    this.aggregatedFeatures = {};
    this.syncTimeout = null;
    this.lastSentFullState = null;
    this.pendingManualTrigger = false;
  }

  // --- 🛠️ HOOKS À SURCHARGER (Dans tf1.js, youtube.js...) ---
  scrapeTopData() { return {}; }
  getCustomState() { return {}; }
  getContainerClasses() { return 'bg-slate-900/40 border-white/5 shadow-2xl'; }
  getHeaderExtra() { return 'null'; }
  getContentTop() { return 'null'; }
  getContentBottom() { return 'null'; }
  getFooterExtra() { return 'null'; }

  // --- 📏 RÈGLES DE SYNCHRO (Vraiment Agnostique V2) ---
  getSyncRules() {
    return {
      'media.paused': { type: 'DISCRETE' },
      'media.playbackRate': { type: 'DISCRETE' },
      'media.time': { 
        type: 'CONTINUOUS', 
        driftThreshold: 2.0, 
        speedKey: 'media.playbackRate',
        activeIfKey: 'media.paused',
        activeInverted: true 
      }
    };
  }

  // --- MOTEUR DOM VIDÉO ---
  findVideoElement() {
    return document.querySelector('video') || document.querySelector('audio');
  }

  getVideo() {
    const currentVideo = this.findVideoElement();
    if (!currentVideo) {
        this.videoElement = null;
        return null;
    }

    if (currentVideo !== this.videoElement) {
      this.videoElement = currentVideo;
      const trigger = () => window.top.postMessage({ type: 'SW_TRIGGER_SYNC' }, '*');
      // On écoute tous les événements qui changent l'état
      ['play', 'pause', 'seeked', 'ratechange'].forEach(e => {
        this.videoElement.addEventListener(e, trigger);
      });
    }

    // 🛡️ Sécurité : Si la vidéo a été supprimée du DOM, on nettoie
    if (this.videoElement && !document.body.contains(this.videoElement)) {
      this.videoElement = null;
      return null;
    }

    return this.videoElement;
  }

  getBaseState() {
    const v = this.getVideo();
    if (!v) return null;
    return {
      time: v.currentTime,
      paused: v.paused,
      duration: v.duration || 0,
      playbackRate: v.playbackRate || 1.0
    };
  }

  applyBaseState(s) {
    const v = this.getVideo();
    if (!v || !s) return;

    if (Math.abs(v.currentTime - s.time) > 1.5) {
      v.currentTime = s.time;
    }
    
    if (v.paused !== s.paused) {
      s.paused ? v.pause() : v.play().catch(() => {});
    }

    if (v.playbackRate !== s.playbackRate) {
        v.playbackRate = s.playbackRate;
    }
  }

  init() {
    if (window.location.href.startsWith('about:')) return; 
    window === window.top ? this.initTopMaster() : this.initIframeSensor();
  }

  getIncrementalDiff(newState, oldState) {
      if (!oldState) return newState;
      const rules = this.getSyncRules();
      const diff = {};
      let hasChanged = false;

      const compareRecursive = (newObj, oldObj, currentPath = '') => {
          const patch = {};
          let subChanged = false;

          for (const key in newObj) {
              const path = currentPath ? `${currentPath}.${key}` : key;
              const valNew = newObj[key];
              const valOld = oldObj ? oldObj[key] : undefined;

              if (rules[path]?.type === 'CONTINUOUS') continue;

              if (valNew !== null && typeof valNew === 'object') {
                  const subPatch = compareRecursive(valNew, valOld, path);
                  if (subPatch) { patch[key] = subPatch; subChanged = true; }
              } 
              else if (valNew !== valOld) {
                  patch[key] = valNew;
                  subChanged = true;
              }
          }
          return subChanged ? patch : null;
      };

      return compareRecursive(newState, oldState);
  }

  initTopMaster() {
    if (window.swInitDone) return;
    window.swInitDone = true;

    const forceSync = (isManualTrigger = false) => {
        // 1. On mémorise l'urgence. Si un seul événement est manuel, tout le paquet devient urgent.
        if (isManualTrigger) {
            this.pendingManualTrigger = true;
        }

        // On annule l'envoi précédent si un nouvel événement arrive très vite
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        
        // 2. Le calcul se fait AU MOMENT de l'envoi, pas avant
        this.syncTimeout = setTimeout(() => {
            const currentState = {
                media: this.getBaseState(),
                features: this.scrapeTopData(),
                url: window.location.href
            };

            const patch = this.getIncrementalDiff(currentState, this.lastSentFullState);
            
            // 🚨 C'est une priorité si on a cliqué OU s'il y a un vrai changement
            const isPriority = this.pendingManualTrigger || patch !== null;

            if (isPriority) {
                // On met à jour l'historique seulement au moment d'envoyer l'action
                this.lastSentFullState = JSON.parse(JSON.stringify(currentState));
            }

            const packet = {
                ts: Date.now(),
                isPriority: isPriority,
                // On envoie le patch. Si le patch est null (ex: le DOM a été trop lent), on envoie l'état complet par sécurité.
                data: isPriority ? (patch || currentState) : currentState, 
                fullState: currentState,
                sidebarCode: !this.uiSent ? this.getSidebarCode() : null,
                syncRules: !this.uiSent ? this.getSyncRules() : null
            };
            
            this.sendReportToApp(packet).then(() => { if (packet.sidebarCode) this.uiSent = true; });
            
            // 3. On réinitialise la mémoire une fois le colis parti
            this.pendingManualTrigger = false;
        }, 50); // J'ai monté à 50ms pour regrouper parfaitement le clic et l'événement DOM de la vidéo
    };

    window.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'SW_INFO') {
            if (e.data.media) this.aggregatedMedia = e.data.media;
            if (e.data.features) this.aggregatedFeatures = { ...this.aggregatedFeatures, ...e.data.features };
        }
        if (e.data.type === 'SW_TRIGGER_SYNC') {
            forceSync(true);
        }
    });

    // --- Dans BaseSyncPlugin.js ---

    this.listenToApp((cmd, data) => {
        if (cmd === 'APPLY_STATE' && data.media) {
            this.applyBaseState(data.media);
            document.querySelectorAll('iframe').forEach(f => {
                f.contentWindow?.postMessage({ type: 'SW_APPLY_STATE', payload: data }, '*');
            });
        }
        // 🛡️ CORRECTION : false, car c'est une réaction à un ordre, pas un déclencheur manuel
        forceSync(false); 
    });

    window.addEventListener('pagehide', () => {
        this.sendReportToApp({
            media: null, 
            features: { title: 'Déconnexion...' }, 
            sidebarCode: null
        }).catch(() => {});
    });

    setInterval(() => forceSync(false), 3000);
    forceSync();
  }

  initIframeSensor() {
    const sendToTop = () => {
        window.top.postMessage({
            type: 'SW_INFO',
            media: this.getBaseState(),
            features: this.getCustomState()
        }, '*');
    };

    window.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'SW_FORCE_UPDATE') sendToTop();
        if (e.data.type === 'SW_APPLY_STATE' && e.data.payload.media) {
            this.applyBaseState(e.data.payload.media);
        }
    });

    sendToTop();
  }

  // --- 🎨 RENDERS PREMIUM ---

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
            props.sendControl('APPLY_STATE', { media: { paused: !isPaused, time: localTime } });
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

  getSidebarCode() {
    const pluginName = this.name;
    const classes = this.getContainerClasses();
    return `(props) => {
      const media = props.media;
      const features = props.features;
      
      const isIdle = !media;
      const isAd = !!features?.isAd;
      const isWatch = !!media && !isAd;

      const time = media?.time || 0;
      const duration = media?.duration || 0;
      const isPaused = media ? media.paused : true;

      const [isDragging, setIsDragging] = React.useState(false);
      const [localTime, setLocalTime] = React.useState(time);

      React.useEffect(() => {
        if (!media) return;
        if (!isDragging) {
            setLocalTime(prev => Math.abs(prev - time) > 0.5 ? time : prev);
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

      return React.createElement('div', { 
        className: 'flex flex-col items-center justify-center w-full h-[85vh] p-10 gap-8 animate-in fade-in duration-500 ${classes}'
      }, [
        ${this.renderBadgeCode(pluginName, this.getHeaderExtra())},
        ${this.getContentTop()},

        isIdle ? React.createElement('div', { key: 'idle', className: 'flex flex-col items-center gap-4 opacity-50 my-10' }, [
            React.createElement('span', { className: 'text-xs font-bold text-white uppercase tracking-widest' }, 'En attente de vidéo...')
        ]) : null,

        isAd ? React.createElement('div', { key: 'ad', className: 'my-10 animate-pulse' }, [
            React.createElement('span', { className: 'text-xl font-black text-red-500 tracking-widest' }, 'PUBLICITÉ')
        ]) : null,

        isWatch ? React.createElement('div', { key: 'watch', className: 'flex flex-col items-center w-full gap-4' }, [
            ${this.renderTimerCode()},
            ${this.renderPlayPauseButtonCode()},
            ${this.renderSliderCode()}
        ]) : null,

        ${this.getContentBottom()},
        ${this.getFooterExtra()}
      ]);
    }`;
  }
}