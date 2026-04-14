import React, { useState, useCallback, useRef } from 'react';
import { SyncEngine } from './SyncEngine';
import { Crown, LogOut, Radio, Cpu, Square } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// Indispensable pour que les plugins puissent utiliser React.createElement
(window as any).React = React;

interface Props {
  roomId: string;
  isHost: boolean;
  members: any[];
  activeUrl: string;
  activePluginId: string; // NOUVEAU
  onLeave: () => void;

  onStop: () => void;
  onNavigate?: (targetUrl: string) => void;
}




export const WatchScreen: React.FC<Props> = ({ roomId, isHost, members, activeUrl, activePluginId, onLeave, onStop, onNavigate }) => {



  // 1. Les états bruts
  const [mediaState, setMediaState] = useState<any>(null); // Null par défaut (IDLE)
  const [featuresState, setFeaturesState] = useState<any>(null);


  
  // 2. Le composant unique du plugin
  const [PluginUI, setPluginUI] = useState<React.FC<any> | null>(null);
  const lastCode = useRef<string | null>(null);

  const handleUpdate = useCallback((payload: any) => {
    const { media, features, sidebarCode } = payload;

    // 🧠 GESTION DE L'ÉTAT (IDLE ou ACTIVE)
    if (media === null) {
      setMediaState(null);
      setFeaturesState(null); // Cohérence avec media: null
    } else if (media) {
      setMediaState((prev: any) => {
        if (!prev) return media;
        return { ...prev, ...media };
      });
    }

    // Mise à jour des features (uniquement si on n'est pas en train de passer en IDLE)
    if (media !== null && features && Object.keys(features).length > 0) {
      setFeaturesState((prev: any) => ({ ...prev, ...features }));
    }

    // Compilation du plugin
    if (sidebarCode && sidebarCode !== lastCode.current) {
      try {
        const factory = new Function('React', `return ${sidebarCode}`);
        setPluginUI(() => factory(React));
        lastCode.current = sidebarCode;
      } catch (e) {
        console.error(`[SyncWatch] ⚠️ Échec de compilation :`, e);
      }
    }
  }, []);


  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return "00:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return (h > 0 ? h + ':' : '') + m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0');
  };

  const handleControl = useCallback((command: string, data: any) => {

      // Envoi au backend (Tauri → shim sur le remote)
      invoke('playback_control', { command, data }).catch(console.error);

      // Mise à jour optimiste dans React (instantanéité visuelle)
      if (command === 'APPLY_STATE' && data.media) {
          setMediaState((prev: any) => ({ ...prev, ...data.media }));
      }
  }, []);

  return (
    <div className="relative flex flex-col h-screen w-full bg-gradient-to-b from-[#0f172a] via-[#020617] to-[#020617] text-slate-200 border-r border-white/5 shadow-2xl overflow-hidden font-sans select-none">
      
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
      <div className="px-5 py-2 bg-white/[0.01] border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Radio size={12} className="text-indigo-400/60" />
            <span className="text-[9px] text-slate-500 uppercase tracking-[0.3em] font-bold">Session</span>
          </div>

          {/* Connected Members */}
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1.5">
              {members.slice(0, 5).map((m, i) => (
                <div 
                  key={m.id} 
                  title={m.name}
                  className="w-5 h-5 rounded-full border border-[#020617] bg-slate-800 flex items-center justify-center text-[8px] font-black uppercase overflow-hidden"
                  style={{ backgroundColor: `hsl(${(i * 137) % 360}, 60%, 40%)` }}
                >
                  {m.name ? m.name.substring(0, 1) : '?'}
                </div>
              ))}
              {members.length > 5 && (
                <div className="w-5 h-5 rounded-full border border-[#020617] bg-slate-900 flex items-center justify-center text-[7px] font-black text-slate-500">
                  +{members.length - 5}
                </div>
              )}
            </div>
            {members.length > 0 && (
              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                {members.length} {members.length > 1 ? 'members' : 'member'}
              </span>
            )}
          </div>
        </div>

        <button 
          onClick={(e) => {
            navigator.clipboard.writeText(roomId);
            const target = e.currentTarget as HTMLElement;
            if (target) {
              const originalText = target.innerText;
              target.innerText = 'COPIED!';
              target.style.color = '#34d399'; // emerald-400
              setTimeout(() => {
                target.innerText = originalText;
                target.style.color = '';
              }, 1000);
            }
          }}

          className="font-mono text-[11px] text-indigo-400 font-black tracking-tight hover:text-white transition-colors cursor-pointer active:scale-95"
          title="Click to copy"
        >
          {roomId}
        </button>
      </div>


      {/* ── MAIN CONTENT (The Dumb Shell) ── */}
      <div className="flex-1 flex flex-row overflow-hidden">
        
        {/* LEFT SIDE : VIDEO SIMULATION (Interactive Faux Player) */}
        <div className="flex-[1.5] relative bg-[#020617] flex flex-col border-r border-white/5 overflow-hidden group">
          
          {/* Header Info */}
          <div className="absolute top-6 left-8 z-30 flex flex-col gap-1">
             <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Remote Simulation</span>
             </div>
             {activeUrl && (
               <div className="text-[9px] font-mono text-white/20 truncate max-w-sm lowercase tracking-tighter">
                 {activeUrl}
               </div>
             )}
          </div>

          {/* Central Interactive Area */}
          <div 
             className="flex-1 flex items-center justify-center relative group/inner cursor-pointer"
             onClick={() => handleControl('APPLY_STATE', { media: { paused: !mediaState?.paused } })}
          >
             {/* Dynamic Blur Glow */}
             <div className={`absolute w-64 h-64 rounded-full blur-[120px] transition-all duration-1000 ${mediaState?.paused ? 'bg-indigo-500/5' : 'bg-emerald-500/10'}`} />
             
             <div className="relative z-10 transition-transform duration-500 group-hover/inner:scale-110">
                {mediaState?.paused ? (
                  <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-sm shadow-2xl">
                     <div className="w-0 h-0 border-t-[12px] border-t-transparent border-l-[20px] border-l-white border-b-[12px] border-b-transparent translate-x-1" />
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center backdrop-blur-sm">
                     <div className="flex gap-2">
                        <div className="w-2 h-10 bg-emerald-400 rounded-full" />
                        <div className="w-2 h-10 bg-emerald-400 rounded-full" />
                     </div>
                  </div>
                )}
             </div>

             <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/inner:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-20 pointer-events-none">
                <span className="text-[10px] font-black tracking-[0.5em] text-white/60 uppercase">
                  {mediaState?.paused ? 'Click to Play' : 'Click to Pause'}
                </span>
             </div>
          </div>

          {/* Bottom Control Bar */}
          <div className="px-12 py-10 bg-gradient-to-t from-black via-black/80 to-transparent relative z-20">
             <div className="flex items-center justify-between mb-4 px-1">
                <div className="flex items-center gap-3">
                   <span className="font-mono text-xs font-black text-white">{formatTime(mediaState?.time)}</span>
                   <span className="text-[10px] text-white/20">/</span>
                   <span className="font-mono text-xs font-bold text-white/40">{formatTime(mediaState?.duration)}</span>
                </div>
                {featuresState?.title && (
                   <span className="text-[10px] font-black text-indigo-400/60 uppercase tracking-widest truncate max-w-xs transition-colors hover:text-indigo-400">
                     {featuresState.title}
                   </span>
                )}
             </div>

             {/* Interactive Custom Slider */}
             <div className="relative group/slider flex items-center h-4 cursor-pointer">
                <div className="absolute h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                   <div 
                      className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300"
                      style={{ width: `${(mediaState?.time / mediaState?.duration) * 100}%` }}
                   />
                </div>
                <input 
                   type="range"
                   min={0}
                   max={mediaState?.duration || 100}
                   value={mediaState?.time || 0}
                   onChange={(e) => handleControl('APPLY_STATE', { media: { time: parseFloat(e.target.value) } })}
                   className="absolute w-full h-full opacity-0 cursor-pointer z-30"
                />
             </div>
          </div>
        </div>


        {/* RIGHT SIDE : CONTROLS */}
        <div className="flex-1 flex flex-col bg-white/[0.02] backdrop-blur-3xl overflow-y-auto">
          {PluginUI ? (
              <div className="w-full h-full flex flex-col">
                  <PluginUI 
                    media={mediaState} 
                    features={featuresState} 
                    sendControl={handleControl} 
                  />
              </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-10">
                <Radio size={48} className="text-white animate-spin-slow" />
                <span className="mt-4 text-[10px] font-black tracking-[0.3em] uppercase">Syncing UI...</span>
            </div>
          )}
        </div>
      </div>


      <SyncEngine
        isHost={isHost}
        onUpdate={handleUpdate}
        onNavigate={onNavigate}
        activePluginId={activePluginId}
      />




    </div>
  );
};