import React, { useState, useCallback, useRef } from 'react';
import { SyncEngine } from './SyncEngine';
import { Crown, LogOut, Radio, Cpu, Square, Share2, Check, Tv } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { socket } from '../services/socket';

// Indispensable pour que les plugins puissent utiliser React.createElement
(window as any).React = React;

interface Props {
  roomId: string;
  isHost: boolean;
  members: any[];
  activeUrl: string | null;
  activePluginId: string | null;
  clockOffset: number;
  onLeave: () => void;
  onStop: () => void;
  onNavigate?: (targetUrl: string) => void;
  initialRoomState?: any;
}

export const WatchScreen: React.FC<Props> = ({
  roomId,
  isHost,
  members,
  activeUrl,
  activePluginId,
  clockOffset,
  onLeave,
  onStop,
  onNavigate,
  initialRoomState,
}) => {
  // 1. Les états bruts
  const [mediaState, setMediaState] = useState<any>(null); // Null par défaut (IDLE)
  const [featuresState, setFeaturesState] = useState<any>(null);
  const [currentLocalUrl, setCurrentLocalUrl] = useState<string | null>(activeUrl);
  const [isSharedFeedback, setIsSharedFeedback] = useState(false);

  // 2. Le composant unique du plugin
  const [PluginUI, setPluginUI] = useState<React.FC<any> | null>(null);
  const lastCode = useRef<string | null>(null);

  const handleUpdate = useCallback((payload: any) => {
    const { media, features, sidebarCode, activeUrl: reportedUrl } = payload;

    if (reportedUrl) {
      setCurrentLocalUrl(reportedUrl);
    }

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

  const handleControl = useCallback((command: string, data: any) => {
    // Envoi au backend (Tauri)
    invoke('playback_control', { command, data }).catch(console.error);

    // Mise à jour optimiste dans React (instantanéité visuelle)
    if (command === 'APPLY_STATE' && data.media) {
      setMediaState((prev: any) => ({ ...prev, ...data.media }));
    }
  }, []);

  const handleBroadcastVideo = useCallback(() => {
    const targetUrl = currentLocalUrl || activeUrl;
    if (!targetUrl) return;

    console.log('[SyncWatch] 📡 Diffusion manuelle de la vidéo :', targetUrl);

    socket.emit('SEND_ACTION', {
      ts: Date.now() + clockOffset,
      data: {
        activeUrl: targetUrl,
        activePluginId: activePluginId,
        media: mediaState
          ? {
              time: mediaState.time || 0,
              paused: mediaState.paused ?? true,
              playbackRate: mediaState.playbackRate || 1.0,
            }
          : undefined,
      },
    });

    setIsSharedFeedback(true);
    setTimeout(() => setIsSharedFeedback(false), 2000);
  }, [currentLocalUrl, activeUrl, activePluginId, clockOffset, mediaState]);

  const getDisplayDomain = (url: string | null) => {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return null;
    }
  };

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
              {members.slice(0, 5).map((m, i) => {
                const isAd = m.features?.isAd === true;
                return (
                  <div
                    key={m.id}
                    title={isAd ? `[PUB] ${m.name}` : m.name}
                    className={`w-5 h-5 rounded-full border border-[#020617] flex items-center justify-center text-[8px] font-black uppercase overflow-hidden transition-all duration-500 ${
                      isAd
                        ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] ring-1 ring-red-500 animate-pulse'
                        : 'bg-slate-800'
                    }`}
                    style={{
                      backgroundColor: isAd ? '' : `hsl(${(i * 137) % 360}, 60%, 40%)`,
                    }}
                  >
                    {isAd ? 'AD' : m.name ? m.name.substring(0, 1) : '?'}
                  </div>
                );
              })}
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

      {/* ── BROADCAST BAR (Diffusion manuelle) ── */}
      <div className="px-5 py-2.5 bg-gradient-to-r from-indigo-950/30 via-slate-900/40 to-indigo-950/20 border-b border-white/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <Tv size={13} className="text-indigo-400 shrink-0" />
          <span className="text-[10px] font-semibold text-slate-400 truncate">
            {featuresState?.ytTitle || getDisplayDomain(currentLocalUrl || activeUrl) || 'En direct'}
          </span>
        </div>

        <button
          onClick={handleBroadcastVideo}
          disabled={!currentLocalUrl && !activeUrl}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-300 shadow-md cursor-pointer shrink-0 active:scale-95 ${
            isSharedFeedback
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-emerald-500/20'
              : 'bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border border-indigo-500/30 hover:border-indigo-500/60 shadow-indigo-500/10'
          }`}
          title="Envoyer cette vidéo à tous les membres du salon"
        >
          {isSharedFeedback ? (
            <>
              <Check size={11} className="text-emerald-400" />
              <span>Diffusé !</span>
            </>
          ) : (
            <>
              <Share2 size={11} className="text-indigo-300" />
              <span>Diffuser la vidéo</span>
            </>
          )}
        </button>
      </div>

      {/* ── MAIN CONTENT (The Dumb Shell) ── */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
        {PluginUI ? (
            <div className="w-full h-full flex flex-col">
                <PluginUI 
                  media={mediaState} 
                  features={featuresState} 
                  sendControl={handleControl} 
                />
            </div>
        ) : (
          <div className="flex flex-col items-center gap-6 opacity-10">
              <Cpu size={64} className="text-white animate-pulse" />
              <span className="text-[10px] font-black tracking-[0.5em] uppercase">LINKING...</span>
          </div>
        )}
      </div>

      <SyncEngine
        isHost={isHost}
        onUpdate={handleUpdate}
        onNavigate={onNavigate}
        activePluginId={activePluginId}
        initialRoomState={initialRoomState}
        clockOffset={clockOffset}
      />




    </div>
  );
};