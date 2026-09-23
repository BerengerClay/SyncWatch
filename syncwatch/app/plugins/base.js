/**
 * SyncWatch - BaseSyncPlugin V12 (Pure State Machine / No Blind Timeout)
 */
class BaseSyncPlugin extends SyncWatchCore {
  constructor() {
    super();
    this.name = "Base Plugin";
    this.uiSent = false;
    this.videoElement = null;
    this.aggregatedState = {};
    this.syncTimeout = null;
  }

  // --- 🛠️ HOOKS À SURCHARGER (Dans tf1.js, youtube.js...) ---
  scrapeTopData() {
    return {};
  }
  getCustomState() {
    return {};
  }
  getContainerClasses() {
    return "bg-slate-900/40 border-white/5 shadow-2xl";
  }
  getHeaderExtra() {
    return "null";
  }
  getContentTop() {
    return "null";
  }
  getContentBottom() {
    return "null";
  }
  getFooterExtra() {
    return "null";
  }

  // --- 📏 RÈGLES DE SYNCHRO (Vraiment Agnostique V2) ---
  getSyncRules() {
    return {
      "paused": { type: "DISCRETE" },
      "playbackRate": { type: "DISCRETE" },
      "time": {
        type: "CONTINUOUS",
        driftThreshold: 2.0,
        speedKey: "playbackRate",
        activeIfKey: "paused",
        activeInverted: true,
        blockingIfKey: "seeking",
      },
      "seeking": { type: "IGNORED" },
      "duration": { type: "IGNORED" },
      "readyState": { type: "IGNORED" },
      "activeUrl": { type: "IGNORED" },
      "isAd": {
        type: "DISCRETE",
        collective: true,
        controllable: false,
        reactions: {
          true: { "paused": true },
          false: { "paused": false },
        },
      },
    };
  }

  // --- MOTEUR DOM VIDÉO ---
  findVideoElement() {
    return document.querySelector("video") || document.querySelector("audio");
  }

  getVideo() {
    const currentVideo = this.findVideoElement();
    if (!currentVideo) {
      this.videoElement = null;
      return null;
    }

    if (currentVideo !== this.videoElement) {
      this.videoElement = currentVideo;

      const triggerSync = () => {
        // 🟢 Priming de l'iframe avant d'avertir le master
        if (window !== window.top) {
          window.top.postMessage(
            {
              type: "SW_INFO",
              state: this.getBaseState(),
            },
            "*",
          );
        }
        window.top.postMessage({ type: "SW_TRIGGER_SYNC" }, "*");
      };

      // 🪓 L'ÉLAGAGE PARFAIT : On écoute les événements de base
      ["play", "pause", "seeked", "seeking", "ratechange"].forEach((e) => {
        this.videoElement.addEventListener(e, () => triggerSync());
      });
    }

    if (this.videoElement && !document.body.contains(this.videoElement)) {
      this.videoElement = null;
      return null;
    }
    return this.videoElement;
  }

  getCurrentUrl() {
    return window.location.href;
  }

  getBaseState() {
    const v = this.getVideo();
    if (!v) return null;
    return {
      time: v.currentTime,
      paused: v.paused || v.readyState < 3,
      seeking: v.seeking, // 🟢 NOTRE VIGILE
      readyState: v.readyState || 0, // 📡 VIGILE DE CHARGEMENT
      duration: v.duration || 0,
      playbackRate: v.playbackRate || 1.0,
    };
  }

  applyBaseState(s) {
    const v = this.getVideo();
    if (!v || !s) return;

    // 🗑️ SUPPRIMÉ : Le isApplyingState = true et le setTimeout de 500ms !
    // Le plugin fait juste son boulot mécaniquement :
    if (s.time !== undefined) {
      v.currentTime = s.time;
    }
    if (s.paused !== undefined && v.paused !== s.paused) {
      s.paused ? v.pause() : v.play().catch(() => {});
    }
    if (s.playbackRate !== undefined && v.playbackRate !== s.playbackRate) {
      v.playbackRate = s.playbackRate;
    }
  }

  init() {
    if (window.location.href.startsWith("about:")) return;
    window === window.top ? this.initTopMaster() : this.initIframeSensor();
  }

  initTopMaster() {
    if (window.swInitDone) return;
    window.swInitDone = true;

    const forceSync = () => {
      if (this.syncTimeout) return;

      this.syncTimeout = setTimeout(() => {
        this.syncTimeout = null;

        const currentState = {
          state: {
            ...(this.aggregatedState || {}),
            ...(this.getBaseState() || {}),
            ...this.scrapeTopData(),
            ...this.getCustomState(),
          },
          activeUrl: this.getCurrentUrl(),
          rules: this.getSyncRules(),
        };

        document.querySelectorAll("iframe").forEach((f) => {
          f.contentWindow?.postMessage({ type: "SW_FORCE_UPDATE" }, "*");
        });

        const packet = {
          ts: Date.now(),
          fullState: currentState,
          sidebarCode: !this.uiSent ? this.getSidebarCode() : null,
        };

        this.sendReportToApp(packet).then(() => {
          if (packet.sidebarCode) this.uiSent = true;
        });
      }, 50);
    };

    window.addEventListener("message", (e) => {
      if (!e.data) return;
      if (e.data.type === "SW_INFO" && e.data.state) {
        this.aggregatedState = {
          ...this.aggregatedState,
          ...e.data.state,
        };
      }
      if (e.data.type === "SW_TRIGGER_SYNC") forceSync();
    });

    this.listenToApp((cmd, data) => {
      if (cmd === "APPLY_STATE" && data.state) {
        // 🛡️ DOUBLE SÉCURITÉ : Le plugin refuse de bouger s'il sait qu'il y a une pub
        if (this.getCustomState().isAd) {
          console.log("[%s] 🛡️ Plugin Sanctuary: Ignoring sync order during ad.", this.name);
          return;
        }

        this.aggregatedState = {
          ...(this.aggregatedState || {}),
          ...data.state,
        };
        this.applyBaseState(data.state);

        document.querySelectorAll("iframe").forEach((f) => {
          f.contentWindow?.postMessage(
            { type: "SW_APPLY_STATE", payload: data },
            "*",
          );
        });
      }
      // Si ça vient de l'humain (bouton Sidebar), on force un scan
      if (data && data.isLocal) forceSync();
    });

    window.addEventListener("pagehide", () => {
      this.sendReportToApp({
        fullState: { state: { title: "Déconnexion..." } },
        sidebarCode: null,
      }).catch(() => {});
    });

    setInterval(() => forceSync(), 500);
    forceSync();
  }

  initIframeSensor() {
    const sendToTop = () => {
      window.top.postMessage(
        {
          type: "SW_INFO",
          state: {
            ...(this.getBaseState() || {}),
            ...this.getCustomState(),
          }
        },
        "*"
      );
    };

    window.addEventListener("message", (e) => {
      if (!e.data) return;
      if (e.data.type === "SW_FORCE_UPDATE") sendToTop();
      if (e.data.type === "SW_APPLY_STATE" && e.data.payload.state) {
        this.applyBaseState(e.data.payload.state);
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
            props.sendControl('APPLY_STATE', { 
                state: { paused: !isPaused },
                isLocal: true
            });
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
                props.sendControl('APPLY_STATE', { 
                    state: { time: val },
                    isLocal: true
                });
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
      const state = props.state || {};
      
      const isIdle = Object.keys(state).length === 0;
      const isAd = !!state.isAd;
      const isWatch = !isIdle && !isAd;

      const time = state.time || 0;
      const duration = state.duration || 0;
      const isPaused = state.paused !== undefined ? state.paused : true;

      const [isDragging, setIsDragging] = React.useState(false);
      const [localTime, setLocalTime] = React.useState(time);

      React.useEffect(() => {
        if (isIdle) return;
        if (!isDragging) {
            setLocalTime(prev => Math.abs(prev - time) > 0.5 ? time : prev);
        }
      }, [time, isDragging, state]);

      React.useEffect(() => {
        if (isIdle) return;
        let interval;
        if (!isPaused && !isDragging) {
            interval = setInterval(() => setLocalTime(prev => prev + 0.1), 100);
        }
        return () => clearInterval(interval);
      }, [isPaused, isDragging, state]);

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
