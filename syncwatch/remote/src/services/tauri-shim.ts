/**
 * SyncWatch - Tauri Shim for Web Remote
 *
 * Remplace @tauri-apps/api/core  → { invoke }
 *          @tauri-apps/api/event → { listen }
 *
 * Le shim charge les vrais plugins et les lance via initTopMaster() sans
 * aucune modification de base.js. On redirige seulement 3 méthodes :
 *
 *   getVideo()       → VirtualVideoEngine (fake HTMLVideoElement)
 *   sendReportToApp  → nos listeners player-update
 *   listenToApp      → no-op  (état géré par applyState + events DOM-like)
 *
 * Le VirtualVideoEngine émette de vrais events (seeked, play, pause, ratechange)
 * que le plugin intercepte via SW_TRIGGER_SYNC → forceSync(true) (isManualTrigger).
 * Toute la logique uiSent / syncRules / isManualTrigger reste dans le plugin.
 */

// ─── 🎞️ VIRTUAL VIDEO ENGINE ─────────────────────────────────────────────────
// Simule un HTMLVideoElement pour que le plugin puisse le surveiller normalement.

class VirtualVideoEngine {
    private _currentTime:  number  = 0;
    private _paused:        boolean = true;
    private _duration:      number  = 0;
    private _playbackRate:  number  = 1.0;
    private _lastTick:      number  = performance.now();
    private _handlers:      Map<string, Function[]> = new Map();

    constructor() {
        // Plus de boucle infinie — on calcule à la volée
    }

    /**
     * "Fige" le temps calculé dans _currentTime et réinitialise le timestamp de référence.
     * Appelé avant chaque changement d'état (play, pause, seek, ratechange).
     */
    private _syncClock() {
        if (!this._paused && this._duration > 0) {
            const now = performance.now();
            const delta = (now - this._lastTick) / 1000;
            this._currentTime = Math.min(
                this._currentTime + (delta * this._playbackRate),
                this._duration
            );
        }
        this._lastTick = performance.now();
    }

    // ─── HTMLVideoElement-like API (pour le plugin) ───────────────────────────

    private _emit(event: string) {
        (this._handlers.get(event) ?? []).forEach(h => (h as any)());
    }

    addEventListener(event: string, handler: Function) {
        if (!this._handlers.has(event)) this._handlers.set(event, []);
        this._handlers.get(event)!.push(handler);
    }
    removeEventListener(event: string, handler: Function) {
        const arr = this._handlers.get(event) ?? [];
        this._handlers.set(event, arr.filter(h => h !== handler));
    }

    get currentTime() { 
        if (this._paused || this._duration <= 0) return this._currentTime;
        
        const now = performance.now();
        const delta = (now - this._lastTick) / 1000;
        const projected = this._currentTime + (delta * this._playbackRate);
        
        if (projected >= this._duration) {
            return this._duration;
        }
        return projected;
    }

    get paused()       { return this._paused;        }
    get duration()     { return this._duration;      }
    get playbackRate() { return this._playbackRate;  }

    set currentTime(v: number) { 
        console.log(`[Shim] 🕒 Seek → ${v.toFixed(2)}s`);
        this._syncClock();
        this._currentTime = v; 
        this._emit('seeked');    
    }
    set playbackRate(v: number) { 
        this._syncClock();
        this._playbackRate = v; 
        this._emit('ratechange'); 
    }

    play() : Promise<void> { 
        if (this._paused) {
            console.log('[Shim] ▶️ Play');
            this._syncClock();
            this._paused = false; 
            this._emit('play');  
        }
        return Promise.resolve(); 
    }
    pause() { 
        if (!this._paused) {
            console.log('[Shim] ⏸️ Pause');
            this._syncClock();
            this._paused = true;  
            this._emit('pause');             
        }
    }

    // ─── API SyncWatch ────────────────────────────────────────────────────────

    applyMediaState(m: any) {
        if (!m) return;
        this._syncClock(); // On met à jour avant d'appliquer les changements

        if (m.duration !== undefined)
            this._duration = m.duration;
        
        if (m.playbackRate !== undefined && m.playbackRate !== this._playbackRate)
            this.playbackRate = m.playbackRate;

        if (m.time !== undefined && Math.abs(this.currentTime - m.time) > 0.5)
            this.currentTime = m.time;

        if (m.paused !== undefined && m.paused !== this._paused)
            m.paused ? this.pause() : this.play();
    }

    snapshot() {
        return {
            time:         this.currentTime,
            paused:       this._paused,
            duration:     this._duration,
            playbackRate: this._playbackRate,
        };
    }
}


let _video: VirtualVideoEngine | null = null;
let _features: any = {};
let _activeUrl: string | null = null; // Stockage de l'URL synchronisée


// ─── 🔌 PLUGIN MANAGEMENT ─────────────────────────────────────────────────────

let _activePlugin:     any            = null;
let _activePluginId:   string | null  = null;
let _loadingPluginId:  string | null  = null;
let _triggerCleanup:   (() => void) | null = null; // désabonnement des events SW_TRIGGER_SYNC

async function _loadPlugin(pluginId: string) {
    if (_activePluginId === pluginId) {
        // Déjà actif ? On force juste une réinitialisation du code
        if (_activePlugin) {
            _activePlugin.uiSent = false;
            // On laisse le setInterval normal renvoyer le code
        }
        return;
    }
    
    if (_loadingPluginId === pluginId) return;
    _loadingPluginId = pluginId;
    _activePlugin    = null;

    // Nettoyer les triggers de l'éventuel plugin précédent
    _triggerCleanup?.();
    _triggerCleanup = null;

    try {
        if (!(window as any).SyncWatchCore) {
            const code = await (await fetch('/plugins/core.js')).text();
            (window as any).eval(code + '\nwindow.SyncWatchCore = SyncWatchCore;');
        }
        if (!(window as any).BaseSyncPlugin) {
            const code = await (await fetch('/plugins/base.js')).text();
            (window as any).eval(code + '\nwindow.BaseSyncPlugin = BaseSyncPlugin;');
        }

        console.log(`[Shim] 🔌 Loading plugin '${pluginId}'...`);
        const res = await fetch(`/plugins/${pluginId}.js`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        (window as any).eval(await res.text());

        const instance = (window as any).SW_PLUGIN;
        if (!instance) throw new Error('Plugin did not register window.SW_PLUGIN');

        // ① getVideo → VirtualVideoEngine au lieu du DOM
        //    Si _video est null, le plugin passera naturellement en mode IDLE.
        //    Quand _video sera créé par APPLY_STATE, le plugin le détectera au prochain cycle.
        instance.getVideo = () => _video;

        // ② sendReportToApp → fire nos listeners player-update.
        instance.getCurrentUrl = () => {
            return _activeUrl || '';
        }
        //    On laisse features exactement tel que le plugin l'a généré (agnosticité).
        //    Si le plugin a mis null (idle), on laisse null.
        instance.sendReportToApp = async (packet: any) => {
            if (_activePlugin !== instance) return;
            
            if (packet.fullState) {
                const { url: _unused, ...fullStateWithoutUrl } = packet.fullState;
                packet.fullState = fullStateWithoutUrl;
            }
            
            (_listeners['player-update'] ?? []).forEach(h => h({ payload: packet }));
            return Promise.resolve();
        };


        // ③ listenToApp → no-op
        instance.listenToApp = (_cb: Function) => { /* no-op */ };

        // ④ Trigger manuel pour s'assurer que les events vidéo virtuelle remontent au plugin
        //    Même si BaseSyncPlugin.js le fait, on double le trigger ici pour plus de sécurité.
        const manualTrigger = () => window.postMessage({ type: 'SW_TRIGGER_SYNC' }, '*');
        const domEvents = ['play', 'pause', 'seeked', 'ratechange'] as const;
        
        // On crée un intervalle qui surveille l'existence de _video et s'y attache
        const setupVideoListeners = () => {
            if (_video) {
                domEvents.forEach(e => _video!.addEventListener(e, manualTrigger));
                return true;
            }
            return false;
        };

        // On ré-essaie toutes les 500ms si la vidéo n'était pas là au début
        const checkVideo = setInterval(() => {
            if (setupVideoListeners()) clearInterval(checkVideo);
        }, 500);
        setupVideoListeners();

        _triggerCleanup = () => {
            clearInterval(checkVideo);
            if (_video) {
                domEvents.forEach(e => _video!.removeEventListener(e, manualTrigger));
            }
        };




        instance.uiSent = false;
        _activePlugin = instance;
        _activePluginId = pluginId;
        _loadingPluginId = null;
        delete (window as any).swInitDone;
        
        setTimeout(() => {
            instance.init();
            console.log(`[Shim] ✅ Plugin '${pluginId}' ready — initTopMaster running`);
        }, 1000);


    } catch (e) {
        console.error(`[Shim] ❌ Failed to load plugin '${pluginId}':`, e);
        _loadingPluginId = null;
    }
}

// ─── 📞 LISTENERS (remplace @tauri-apps/api/event) ───────────────────────────
// Pas de setInterval global — le plugin pilote ses updates via initTopMaster.
// Un fallback minimal envoie fullState avant que le plugin soit chargé.

type TauriHandler = (event: { payload: any }) => void;
const _listeners: Record<string, TauriHandler[]> = {};
let   _fallbackInterval: ReturnType<typeof setInterval> | null = null;

export const listen = async (
    event: string,
    handler: TauriHandler
): Promise<() => void> => {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(handler);

    // Fallback avant que le plugin soit chargé :
    // émet fullState sans sidebarCode pour que l'UI de base soit visible.
    if (event === 'player-update' && !_fallbackInterval) {
        _fallbackInterval = setInterval(() => {
            if (_activePlugin) {
                clearInterval(_fallbackInterval!);
                _fallbackInterval = null;
                return;
            }
            const handlers = _listeners['player-update'] ?? [];
            if (handlers.length === 0) return;
            handlers.forEach(h => h({
                payload: { 
                    ts: Date.now(), 
                    fullState: _video ? {
                        media: _video.snapshot(),
                        features: _features
                    } : { media: null, features: null }, 
                    isManualTrigger: false 
                }
            }));


        }, 500);
    }

    return () => {
        _listeners[event] = (_listeners[event] ?? []).filter(h => h !== handler);
    };
};

// ─── 🚀 INVOKE (remplace @tauri-apps/api/core) ───────────────────────────────

export const invoke = async (command: string, args?: any): Promise<any> => {
    switch (command) {

        case 'playback_control': {
            const { command: action, data } = args ?? {};
            if (action === 'APPLY_STATE') {
                // Gestion du cycle de vie du moteur virtuel
                if (data?.media) {
                    if (!_video) _video = new VirtualVideoEngine();
                    _video.applyMediaState(data.media);
                } else if (data?.media === null) {
                    _video = null;
                }

                if (data?.activeUrl) {
                    _activeUrl = data.activeUrl;
                }


                // Persistance des features (titre, features spécifiques...)
                if (data?.features) {
                    _features = { ..._features, ...data.features };
                }

                // Charge le plugin si indiqué dans les données
                const pluginId = data?.activePluginId ?? null;

                if (pluginId && pluginId !== _loadingPluginId) {
                    _loadPlugin(pluginId);
                }
            }

            return;
        }

        case 'get_plugins': {
            const res = await fetch('/plugins/plugins.json');
            return res.json();
        }

        // No-ops : set_view_mode, heartbeat, etc.
        default:
            return Promise.resolve();
    }
};
