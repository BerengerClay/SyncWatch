/**
 * SyncWatch - BaseSyncPlugin V6 (Pro Navigation Edition)
 */
class BaseSyncPlugin {
  constructor() {
    this.name = 'Base Plugin';
    this.lastState = { t: 0, p: null, d: 0 };
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

  // --- LOGIQUE ---
  play(v) { if (v) v.play().catch(() => {}); }
  pause(v) { if (v) v.pause(); }
  seek(v, t) { if (v) v.currentTime = t; }

  init() {
    console.log(`[SyncWatch] 🔌 Moteur ${this.name} initialisé.`);
    window.syncWatchControl = (cmd, data) => {
        const v = this.getVideo();
        if (!v) return;
        if (cmd === 'play') this.play(v);
        if (cmd === 'pause') this.pause(v);
        if (cmd === 'seek') this.seek(v, data);
    };
    this.reportInterval = setInterval(() => this.report(), 400);
  }

  report() {
    const v = this.getVideo();
    if (!v) return;
    const t = v.currentTime;
    const p = v.paused ? 1 : 0;
    const d = v.duration;
    const timeChanged = Math.abs(t - this.lastState.t) > 0.4;
    const statusChanged = p !== this.lastState.p;

    if (!this.uiSent || statusChanged || timeChanged) {
      const payload = {
        t: t, d: isNaN(d) ? 0 : d, p: p,
        sidebarCode: !this.uiSent ? this.getSidebarCode() : null
      };
      if (window.__TAURI_INTERNALS__?.invoke) {
        window.__TAURI_INTERNALS__.invoke('playback_report', { payload })
          .then(() => { this.uiSent = true; })
          .catch(() => {});
      }
      this.lastState = { t, p, d };
    }
  }

  getSidebarCode() {
    const classes = this.getContainerClasses();
    const pluginName = this.name;
    const headerExtra = this.getHeaderExtra();
    const contentTop = this.getContentTop();
    const contentBottom = this.getContentBottom();
    const footerExtra = this.getFooterExtra();

    return `(props) => {
      const { time, duration, isPaused } = props;
      const [isDragging, setIsDragging] = React.useState(false);
      const [localTime, setLocalTime] = React.useState(time);
      
      // États pour la prévisualisation au survol
      const [hoverTime, setHoverTime] = React.useState(0);
      const [hoverPos, setHoverPos] = React.useState(0);
      const [isHovering, setIsHovering] = React.useState(false);

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

      // Calcul du temps en fonction de la position de la souris
      const handleMouseMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        setHoverTime(percent * duration);
        setHoverPos(x);
        setIsHovering(true);
      };

      const progress = duration > 0 ? (localTime / duration) * 100 : 0;

      return React.createElement('div', { 
        className: 'flex flex-col flex-1 w-full p-6 gap-6 transition-all duration-700 ' + '${classes}' 
      }, [
        // --- HEADER ---
        React.createElement('div', { className: 'flex justify-between items-start', key: 'h' }, [
            React.createElement('div', { className: 'flex flex-col gap-1' }, [
              React.createElement('div', { className: 'flex items-center gap-2' }, [
                React.createElement('div', { className: 'w-2 h-2 rounded-full ' + (isPaused ? 'bg-white/10' : 'bg-emerald-400 animate-pulse') }),
                React.createElement('span', { className: 'text-[11px] font-black tracking-[0.3em] text-white/90 uppercase' }, "${pluginName}")
              ]),
              React.createElement('span', { className: 'text-[9px] font-bold text-white/20 uppercase tracking-widest' }, isPaused ? 'Paused' : 'Streaming')
            ]),
            ${headerExtra}
        ]),

        ${contentTop},

        // --- TIMER ---
        React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center py-4', key: 't' }, [
            React.createElement('div', { className: 'relative text-8xl font-mono font-black text-white tracking-tighter tabular-nums' }, formatTime(localTime)),
            React.createElement('span', { className: 'text-[10px] text-white/10 font-black uppercase tracking-[0.4em] mt-2' }, 'Total ' + formatTime(duration))
        ]),

        ${contentBottom},

        // --- INTERACTIVE SLIDER ---
        React.createElement('div', { 
            className: 'bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col gap-4 relative', 
            key: 'f' 
        }, [
            // Tooltip de Preview
            isHovering && React.createElement('div', {
                className: 'absolute bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-xl pointer-events-none transition-transform duration-75 z-50',
                style: { 
                    left: hoverPos + 'px', 
                    top: '-25px', 
                    transform: 'translateX(-50%)' 
                }
            }, formatTime(hoverTime)),

            React.createElement('div', { 
                className: 'group relative h-6 w-full flex items-center',
                onMouseMove: handleMouseMove,
                onMouseLeave: () => setIsHovering(false)
            }, [
                // Fond de la barre
                React.createElement('div', { className: 'absolute h-1.5 w-full bg-white/5 rounded-full overflow-hidden' }),
                
                // Barre de progression (Temps actuel)
                React.createElement('div', { 
                    className: 'absolute h-1.5 bg-emerald-500 rounded-full pointer-events-none z-0',
                    style: { width: progress + '%' }
                }),

                // Barre de Preview (Survol)
                isHovering && React.createElement('div', { 
                    className: 'absolute h-1.5 bg-white/10 rounded-full pointer-events-none z-0',
                    style: { width: (hoverTime / duration * 100) + '%' }
                }),

                // Input invisible (Contrôleur)
                React.createElement('input', {
                    type: 'range',
                    min: 0,
                    max: duration || 100,
                    value: localTime || 0,
                    step: 0.1,
                    onInput: (e) => {
                      setIsDragging(true);
                      setLocalTime(parseFloat(e.target.value));
                    },
                    onChange: (e) => {
                      const val = parseFloat(e.target.value);
                      if (window.__TAURI_INTERNALS__?.invoke) {
                          window.__TAURI_INTERNALS__.invoke('playback_control', { command: 'seek', data: val });
                      }
                      setTimeout(() => setIsDragging(false), 600);
                    },
                    className: 'absolute w-full h-full appearance-none bg-transparent cursor-pointer z-10 accent-emerald-400'
                })
            ])
        ]),

        ${footerExtra}
      ]);
    }`;
  }
}