/**
 * SyncWatch - BaseSyncPlugin V8 (Agnostic State Streaming Edition)
 */
class BaseSyncPlugin extends SyncWatchCore {
  constructor() {
    super(); // Ne surtout pas oublier d'appeler le constructeur du Core !
    this.name = 'Base Plugin';
    this.lastState = { media: null, features: null };
    this.uiSent = false;
    this.videoElement = null;
    this.currentMode = null; 
  }

  findVideoElement() {
    return document.querySelector('video') || document.querySelector('audio');
  }

  getVideo() {
    const currentVideo = this.findVideoElement();

    if (!currentVideo) {
        this.videoElement = null;
        return null;
    }

    if (currentVideo && currentVideo !== this.videoElement) {
      this.videoElement = currentVideo;
      
      this.videoElement.addEventListener('pause', () => this.report());
      this.videoElement.addEventListener('play', () => this.report());
      this.videoElement.addEventListener('seeked', () => this.report());
    }

    if (this.videoElement && !document.body.contains(this.videoElement)) {
      this.videoElement = null;
    }

    return this.videoElement;
  }

  // --- HOOKS ---
  getContainerClasses() { return 'bg-slate-900/40 border-white/5 shadow-2xl'; }
  getHeaderExtra() { return 'null'; }
  getContentTop() { return 'null'; }
  getContentBottom() { return 'null'; }
  getFooterExtra() { return 'null'; }

  getBaseState() {
    const v = this.getVideo();
    if (!v) return null;
    return {
      time: v.currentTime,
      paused: v.paused,
      duration: v.duration || 0
    };
  }

  getCustomState() { return {}; } // À surcharger dans youtube.js / tf1.js

  init() {
    if (window.location.href.startsWith('about:')) {
        return; 
    }

    if (window.swInitDone) return;
    window.swInitDone = true;

    this.listenToApp((cmd, data) => {
        if (cmd === 'APPLY_STATE' && data) {
            if (data.media) this.applyBaseState(data.media);
            if (data.features) this.applyCustomState(data.features);
        } else {
            this.handleCustomCommand(cmd, data);
        }
    });

    this.reportInterval = setInterval(() => this.report(), 2000);
  }

  handleCustomCommand(cmd, data) {}

  report() {
    const currentBase = this.getBaseState();

    if (window !== window.top && !currentBase) return; 

    const newMode = currentBase ? 'WATCH' : 'IDLE';

    if (this.currentMode !== newMode) {
        console.log(`[SyncWatch] 🔄 Bascule de mode : ${this.currentMode} -> ${newMode}`);
        this.currentMode = newMode;
        this.uiSent = false; 
    }

    const payload = {
      mode: this.currentMode,
      media: currentBase, 
      features: this.getCustomState(),
      sidebarCode: !this.uiSent 
          ? (this.currentMode === 'WATCH' ? this.getSidebarCode() : this.getIdleSidebarCode()) 
          : null
    };

    this.sendReportToApp(payload).then(() => { 
      if (payload.sidebarCode) this.uiSent = true; 
    });
  }

  // --- RÉCEPTION DE L'ÉTAT ---
  applyBaseState(mediaState) {
    const v = this.getVideo();
    if (!v) return;

    // Règle de Tolérance : On ne force le temps que si l'écart est > 2 secondes
    // Cela évite les saccades dues à la latence réseau
    if (Math.abs(v.currentTime - mediaState.time) > 2) {
      v.currentTime = mediaState.time;
    }
    
    // Synchronisation de la lecture (Play/Pause)
    if (v.paused !== mediaState.paused) {
      mediaState.paused ? v.pause() : v.play().catch(() => {});
    }
  }

  applyCustomState(featuresState) {} // Pour les plugins enfants

  // --- COMPOSANTS UI (Générateurs de code pour le sidebar) ---

  renderBadgeCode(pluginName, headerExtra) {
    return `React.createElement('div', { key: 'badge', className: 'flex items-center gap-3 mb-6' }, [
      React.createElement('div', { key: 'dot', className: 'w-1.5 h-1.5 rounded-full ' + (isPaused ? 'bg-white/10' : 'bg-emerald-500 animate-pulse') }),
      React.createElement('span', { key: 'name', className: 'text-[10px] font-black text-white/20 uppercase tracking-[0.4em]' }, "${pluginName}"),
      ${headerExtra} // headerExtra doit déjà avoir une key s'il renvoie un tableau
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

  // --- INTERFACE PRINCIPALE (AVEC VIDÉO) ---
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
      const { time = 0, duration = 0, paused = true, features = {} } = props;
      const isPaused = paused;

      const [isDragging, setIsDragging] = React.useState(false);
      const [localTime, setLocalTime] = React.useState(time);

      // 🔄 1. LE RECALIBRAGE (Gestion du Heartbeat de 3.5s)
      React.useEffect(() => {
        if (!isDragging) {
            // Si le décalage entre le temps autonome de React et le vrai temps de la vidéo
            // est supérieur à 1 seconde, on force React à se recaler sur la vraie vidéo.
            // (Si le décalage est minime, on ignore pour éviter les micro-saccades visuelles)
            setLocalTime(prev => Math.abs(prev - time) > 1 ? time : prev);
        }
      }, [time, isDragging]);

      // 🏎️ 2. LE MOTEUR AUTONOME (L'animation ultra fluide)
      React.useEffect(() => {
        let interval;
        // Si la vidéo n'est pas en pause et que l'utilisateur ne touche pas au slider...
        if (!isPaused && !isDragging) {
            // ... React fait avancer le temps tout seul de 0.1s toutes les 100ms !
            interval = setInterval(() => {
                setLocalTime(prev => prev + 0.1);
            }, 100);
        }
        // On nettoie l'intervalle quand on fait pause ou qu'on démonte le composant
        return () => clearInterval(interval);
      }, [isPaused, isDragging]);

      const formatTime = (s) => {
        if (!s || isNaN(s)) return "00:00";
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return (h > 0 ? h + ':' : '') + m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0');
      };

      const progress = duration > 0 ? (localTime / duration) * 100 : 0;

      return React.createElement('div', { 
        key: 'main-container',
        className: 'flex flex-col items-center justify-center w-full h-[85vh] p-10 gap-8 animate-in fade-in duration-1000 ' + '${classes}'
      }, [
        ${badge},
        ${contentTop},
        ${timer},
        ${playBtn},
        ${contentBottom},
        ${slider},
        ${footerExtra}
      ]);
    }`;
  }

  // --- INTERFACE ALTERNATIVE (SANS VIDÉO) ---
  getIdleSidebarCode() {
    const pluginName = this.name;
    const classes = this.getContainerClasses();
    return `() => {
      return React.createElement('div', { 
        key: 'idle-container',
        className: 'flex flex-col items-center justify-center w-full h-[85vh] p-10 gap-8 animate-in fade-in duration-1000 ' + '${classes}'
      }, [
        React.createElement('div', { key: 'badge', className: 'flex items-center gap-3 mb-6' }, [
            React.createElement('div', { key: 'dot', className: 'w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse' }),
            React.createElement('span', { key: 'name', className: 'text-[10px] font-black text-white/20 uppercase tracking-[0.4em]' }, "${pluginName}")
        ]),
        React.createElement('div', { key: 'loading', className: 'flex flex-col items-center gap-4 opacity-50' }, [
            React.createElement('svg', { key: 'icon', className: 'w-16 h-16 text-white/20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2' }, [
                React.createElement('circle', { key: 'c', cx: '11', cy: '11', r: '8' }),
                React.createElement('line', { key: 'l', x1: '21', y1: '21', x2: '16.65', y2: '16.65' })
            ]),
            React.createElement('span', { key: 'txt', className: 'text-xs font-bold text-white uppercase tracking-widest animate-pulse' }, 'Navigation en cours...')
        ])
      ]);
    }`;
  }
}