/**
 * SyncWatch - BaseSyncPlugin V8 (Agnostic State Streaming Edition)
 */
class BaseSyncPlugin {
  constructor() {
    this.name = 'Base Plugin';
    this.lastState = { media: null, features: null };
    this.uiSent = false;
    this.videoElement = null;
  }

  getVideo() {
    if (!this.videoElement || !document.body.contains(this.videoElement)) {
      this.videoElement = document.querySelector('video') || document.querySelector('audio');
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
    if (window.swInitDone) return;
    window.swInitDone = true;

    console.log(`[SyncWatch] 🔌 Moteur ${this.name} initialisé (V8).`);
    
    // L'écouteur global qui distribue les tiroirs d'état
    window.syncWatchControl = (cmd, data) => {
        if (cmd === 'APPLY_STATE' && data) {
            if (data.media) this.applyBaseState(data.media);
            if (data.features) this.applyCustomState(data.features);
        }
    };

    this.reportInterval = setInterval(() => this.report(), 450);
  }

  report() {
    const currentBase = this.getBaseState();

    // --- ÉTAT IDLE (NAVIGATION) ---
    if (!currentBase) {
      if (this.currentMode !== 'IDLE') {
          this.currentMode = 'IDLE';
          this.uiSent = false;
      }
      const idlePayload = {
        mode: 'IDLE',
        media: null,
        features: this.getCustomState(),
        sidebarCode: !this.uiSent ? this.getIdleSidebarCode() : null
      };

      if (window.__TAURI_INTERNALS__?.invoke) {
        window.__TAURI_INTERNALS__.invoke('playback_report', { payload: idlePayload })
          .then(() => { if (idlePayload.sidebarCode) this.uiSent = true; })
          .catch(() => {});
      }
      return;
    }

    // --- ÉTAT WATCH (LECTURE) ---
    if (this.currentMode !== 'WATCH') {
        this.currentMode = 'WATCH';
        this.uiSent = false;
    }

    const fullState = {
      mode: 'WATCH',
      media: currentBase,
      features: this.getCustomState(),
      sidebarCode: !this.uiSent ? this.getSidebarCode() : null
    };

    // On envoie l'état complet dans le tuyau
    if (window.__TAURI_INTERNALS__?.invoke) {
      window.__TAURI_INTERNALS__.invoke('playback_report', { payload: fullState })
        .then(() => { if (fullState.sidebarCode) this.uiSent = true; })
        .catch(() => {});
    }
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

  // --- INTERFACE ALTERNATIVE (SANS VIDÉO) ---
  getIdleSidebarCode() {
    const pluginName = this.name;
    const classes = this.getContainerClasses();
    return `() => {
      return React.createElement('div', { 
        className: 'flex flex-col items-center justify-center w-full h-[85vh] p-10 gap-8 animate-in fade-in duration-1000 ' + '${classes}'
      }, [
        React.createElement('div', { className: 'flex items-center gap-3 mb-6' }, [
            React.createElement('div', { className: 'w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse' }),
            React.createElement('span', { className: 'text-[10px] font-black text-white/20 uppercase tracking-[0.4em]' }, "${pluginName}")
        ]),
        React.createElement('div', { className: 'flex flex-col items-center gap-4 opacity-50' }, [
            React.createElement('svg', { className: 'w-16 h-16 text-white/20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2' }, [
                React.createElement('circle', { cx: '11', cy: '11', r: '8' }),
                React.createElement('line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' })
            ]),
            React.createElement('span', { className: 'text-xs font-bold text-white uppercase tracking-widest animate-pulse' }, 'Navigation en cours...')
        ])
      ]);
    }`;
  }

  // --- INTERFACE PRINCIPALE (AVEC VIDÉO) ---
  getSidebarCode() {
    const pluginName = this.name;
    const classes = this.getContainerClasses();
    const headerExtra = this.getHeaderExtra();
    const contentTop = this.getContentTop();
    const contentBottom = this.getContentBottom();
    const footerExtra = this.getFooterExtra();

    return `(props) => {
      // Les props contiennent les valeurs éclatées de "...mediaState" + "features"
      const { time = 0, duration = 0, paused = true, features = {} } = props;
      const isPaused = paused;

      const [isDragging, setIsDragging] = React.useState(false);
      const [localTime, setLocalTime] = React.useState(time);

      React.useEffect(() => {
        if (!isDragging) setLocalTime(time);
      }, [time, isDragging]);

      const formatTime = (s) => {
        if (!s || isNaN(s)) return "00:00";
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return (h > 0 ? h + ':' : '') + m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0');
      };

      const progress = duration > 0 ? (localTime / duration) * 100 : 0;

      return React.createElement('div', { 
        className: 'flex flex-col items-center justify-center w-full h-[85vh] p-10 gap-8 animate-in fade-in duration-1000 ' + '${classes}'
      }, [
        // --- BADGE ---
        React.createElement('div', { className: 'flex items-center gap-3 mb-6' }, [
            React.createElement('div', { className: 'w-1.5 h-1.5 rounded-full ' + (isPaused ? 'bg-white/10' : 'bg-emerald-500 animate-pulse') }),
            React.createElement('span', { className: 'text-[10px] font-black text-white/20 uppercase tracking-[0.4em]' }, "${pluginName}"),
            ${headerExtra}
        ]),

        ${contentTop},

        // --- TIMER ---
        React.createElement('div', { className: 'flex flex-col items-center gap-2 mt-4' }, [
            React.createElement('span', { 
                className: 'font-mono font-black text-white tabular-nums text-center',
                style: { fontSize: 'clamp(3rem, 12vw, 4.5rem)' }
            }, formatTime(localTime)),
            React.createElement('span', { className: 'text-[11px] font-black text-white/10 uppercase tracking-[0.3em]' }, 'Total: ' + formatTime(duration))
        ]),

        // --- PLAY/PAUSE BUTTON ---
        React.createElement('button', {
            onClick: () => {
                if (window.__TAURI_INTERNALS__?.invoke) {
                    window.__TAURI_INTERNALS__.invoke('playback_control', { 
                        command: 'APPLY_STATE', 
                        data: { media: { paused: !isPaused } } 
                    });
                }
            },
            className: 'group relative flex items-center justify-center w-20 h-20 rounded-full bg-slate-800/40 backdrop-blur-xl border border-white/10 hover:border-emerald-500/50 transition-all duration-700 shadow-[0_0_40px_rgba(0,0,0,0.3)] hover:shadow-emerald-500/20'
        }, [
            // Anneau extérieur pulsant
            React.createElement('div', { className: 'absolute -inset-2 rounded-full border border-emerald-500/0 group-hover:border-emerald-500/10 transition-all duration-1000 scale-90 group-hover:scale-100' }),
            // Halo de lumière
            React.createElement('div', { className: 'absolute inset-0 rounded-full bg-emerald-500/0 group-hover:bg-emerald-500/5 blur-2xl transition-all duration-700' }),
            // Icône avec ombre portée
            isPaused 
                ? React.createElement('svg', { className: 'w-8 h-8 text-white group-hover:text-emerald-400 fill-current translate-x-0.5 transition-all duration-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]', viewBox: '0 0 24 24' }, [
                    React.createElement('path', { d: 'M5 3l14 9-14 9V3z' })
                ])
                : React.createElement('svg', { className: 'w-8 h-8 text-white group-hover:text-emerald-400 fill-current transition-all duration-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]', viewBox: '0 0 24 24' }, [
                    React.createElement('rect', { x: '6', y: '4', width: '4', height: '16', rx: '1.5' }),
                    React.createElement('rect', { x: '14', y: '4', width: '4', height: '16', rx: '1.5' })
                ])
        ]),

        ${contentBottom},

        // --- SLIDER PREMIUM ---
        React.createElement('div', { className: 'relative w-full group/slider flex items-center mt-10 max-w-[300px] h-6 cursor-pointer' }, [
            // Rail Arrière
            React.createElement('div', { className: 'absolute h-1 w-full bg-white/5 rounded-full overflow-hidden' }),
            // Rail Actif dégradé + Glow
            React.createElement('div', { 
                className: 'absolute h-1 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)]', 
                style: { width: progress + '%' } 
            }),
            // Curseur personnalisé (Thumb)
            React.createElement('div', { 
                className: 'absolute w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)] border-2 border-emerald-500 transition-transform duration-200 group-hover/slider:scale-125 group-active/slider:scale-150',
                style: { left: 'calc(' + progress + '% - 7px)', zIndex: 20 }
            }),
            // Input invisible pour le contrôle
            React.createElement('input', {
                type: 'range',
                min: 0, max: duration || 100, value: localTime || 0, step: 0.1,
                onInput: (e) => { setIsDragging(true); setLocalTime(parseFloat(e.target.value)); },
                onChange: (e) => {
                    const val = parseFloat(e.target.value);
                    if (window.__TAURI_INTERNALS__?.invoke) window.__TAURI_INTERNALS__.invoke('playback_control', { command: 'APPLY_STATE', data: { media: { time: val } } });
                    setTimeout(() => setIsDragging(false), 600);
                },
                className: 'absolute w-full h-full appearance-none bg-transparent cursor-pointer z-30 opacity-0'
            })
        ]),

        ${footerExtra}
      ]);
    }`;
  }
}