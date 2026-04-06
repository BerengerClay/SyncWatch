import React, { useState, useCallback, useRef } from 'react';
import { VideoView } from './VideoView';
import { Crown, LogOut, Radio, Cpu, Square } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// Indispensable pour que les plugins puissent utiliser React.createElement
(window as any).React = React;

interface Props {
  roomId: string;
  isHost: boolean;
  onLeave: () => void;
  onStop: () => void;
}

export const WatchScreen: React.FC<Props> = ({ roomId, isHost, onLeave, onStop }) => {
  const [mediaState, setMediaState] = useState<any>({});
  const [featuresState, setFeaturesState] = useState<any>({});
  
  const [IdleUI, setIdleUI] = useState<React.FC<any> | null>(null);
  const [WatchUI, setWatchUI] = useState<React.FC<any> | null>(null);
  const [currentMode, setCurrentMode] = useState<'IDLE'|'WATCH'>('IDLE');
  
  const lastCodes = useRef<{IDLE: string|null, WATCH: string|null}>({IDLE: null, WATCH: null});

const handleUpdate = useCallback((payload: any) => {
    const mode = payload.mode as 'IDLE' | 'WATCH';
    const { media, features, sidebarCode } = payload;
    
    // 1. On applique le mode bêtement (ce que le serveur/plugin décide)
    setCurrentMode(mode);

    // 2. On met à jour les données
    if (media) setMediaState(media);
    if (features) setFeaturesState((prev: any) => ({ ...prev, ...features }));

    // 3. On compile l'UI si on reçoit un nouveau code
    if (sidebarCode && sidebarCode !== lastCodes.current[mode]) {
        try {
            const factory = new Function('React', `return ${sidebarCode}`);
            const Component = factory(React);
            
            if (mode === 'WATCH') setWatchUI(() => Component);
            else setIdleUI(() => Component);
            
            lastCodes.current[mode] = sidebarCode;
            console.log(`[SyncWatch] ✅ ${mode} UI compilé avec succès`);
        } catch (e) {
            console.error(`[SyncWatch] ⚠️ Échec de compilation (${mode}):`, e);
        }
    }
}, []);

  const PluginUI = currentMode === 'WATCH' ? WatchUI : IdleUI;

  // LA VERSION INSTANTANÉE
  const handleControl = useCallback((command: string, data: any) => {
      // 1. On envoie l'ordre à la vidéo (Tauri)
      invoke('playback_control', { command, data }).catch(console.error);

      // 2. NOUVEAU : Mise à jour optimiste (React) !
      if (command === 'APPLY_STATE' && data.media) {
          setMediaState((prev: any) => ({ ...prev, ...data.media }));
      }
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-gradient-to-b from-[#0f172a] via-[#020617] to-[#020617] text-slate-200 border-r border-white/5 shadow-2xl overflow-hidden font-sans select-none">
      
      {/* ── HEADER ── */}
      <div className="px-5 py-4 bg-white/[0.02] border-b border-white/5 flex items-center justify-between shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
            <div className="absolute inset-0 bg-emerald-400/20 blur-md rounded-full" />
          </div>
          <span className="font-black text-xs tracking-[0.2em] text-white/90">SYNCWATCH</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400 px-3 py-1.5 rounded-full border border-white/5 hover:border-indigo-500/20 text-[9px] font-black uppercase tracking-widest transition-all duration-300 active:scale-95"
          >
            <Square size={10} />
            STOP
          </button>
          
          {isHost && (
            <span className="flex items-center gap-1.5 bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full border border-amber-500/20 text-[9px] font-black uppercase tracking-widest">
              <Crown size={10} /> HOST
            </span>
          )}
          <button
            onClick={onLeave}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 px-3 py-1.5 rounded-full border border-white/5 hover:border-red-500/20 text-[9px] font-black uppercase tracking-widest transition-all duration-300 active:scale-95"
          >
            <LogOut size={10} />
            LEAVE
          </button>
        </div>
      </div>

      {/* ── ROOM INDICATOR ── */}
      <div className="px-5 py-2.5 bg-white/[0.01] border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={12} className="text-indigo-400/60" />
          <span className="text-[9px] text-slate-500 uppercase tracking-[0.3em] font-bold">Session</span>
        </div>
        <span className="font-mono text-[11px] text-indigo-400 font-black tracking-tight">{roomId}</span>
      </div>

      {/* ── MAIN CONTENT (The Shell) ── */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
        {PluginUI ? (
            <div className="w-full h-full animate-in fade-in zoom-in duration-700 flex flex-col">
                {/* Injecte sendControl ici ! */}
                <PluginUI {...mediaState} features={featuresState} sendControl={handleControl} />
            </div>
        ) : (
          <div className="flex flex-col items-center gap-6 opacity-10">
              <Cpu size={64} className="text-white animate-pulse" />
              <span className="text-[10px] font-black tracking-[0.5em] uppercase">LINKING...</span>
          </div>
        )}
      </div>

      <VideoView
        roomId={roomId}
        isHost={isHost}
        onUpdate={handleUpdate}
      />
    </div>
  );
};