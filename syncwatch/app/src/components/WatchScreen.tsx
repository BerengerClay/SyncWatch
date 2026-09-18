import React, { useState, useCallback, useRef } from 'react';
import { SyncEngine } from './SyncEngine';
import { Crown, LogOut, Radio, Cpu, Square, Share2, Check, Tv, UserPlus, Users } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// Indispensable pour que les plugins puissent utiliser React.createElement
(window as any).React = React;

interface Props {
  roomId: string;
  isHost: boolean;
  members: any[];
  activeUrl: string | null;
  activePluginId: string | null;
  clockOffset: number;
  currentSessionId?: string | null;
  sessions?: Record<string, any>;
  onLeave: () => void;
  onStop: () => void;
  onNavigate?: (targetUrl: string) => void;
  onSetActiveUrl?: (targetUrl: string | null) => void;
  onJoinSession?: (sessionId: string) => void;
  onBroadcastSession?: (sessionId?: string) => void;
  initialRoomState?: any;
}

export const WatchScreen: React.FC<Props> = ({
  roomId,
  isHost,
  members = [],
  activeUrl,
  activePluginId,
  clockOffset,
  currentSessionId,
  sessions: _sessions = {},
  onLeave,
  onStop,
  onNavigate,
  onSetActiveUrl,
  onJoinSession,
  onBroadcastSession,
  initialRoomState,
}) => {
  const [mediaState, setMediaState] = useState<any>(null);
  const [featuresState, setFeaturesState] = useState<any>(null);
  const [currentLocalUrl, setCurrentLocalUrl] = useState<string | null>(activeUrl);
  const [isSharedFeedback, setIsSharedFeedback] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const [PluginUI, setPluginUI] = useState<React.FC<any> | null>(null);
  const lastCode = useRef<string | null>(null);

  const handleUpdate = useCallback((payload: any) => {
    const { media, features, sidebarCode, activeUrl: reportedUrl } = payload;

    if (reportedUrl) {
      setCurrentLocalUrl(reportedUrl);
    }

    if (media === null) {
      setMediaState(null);
      setFeaturesState(null);
    } else if (media) {
      setMediaState((prev: any) => {
        if (!prev) return media;
        return { ...prev, ...media };
      });
    }

    if (media !== null && features && Object.keys(features).length > 0) {
      setFeaturesState((prev: any) => ({ ...prev, ...features }));
    }

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
    invoke('playback_control', { command, data }).catch(console.error);

    if (command === 'APPLY_STATE' && data.media) {
      setMediaState((prev: any) => ({ ...prev, ...data.media }));
    }
  }, []);

  // 📢 DIFFUSION À TOUT LE SALON
  const handleBroadcast = useCallback(() => {
    const targetUrl = currentLocalUrl || activeUrl;
    if (!targetUrl) return;

    console.log('[SyncWatch] 📢 Diffusion de ma session à tout le salon :', targetUrl);

    if (onSetActiveUrl) {
      onSetActiveUrl(targetUrl);
    }

    if (onBroadcastSession) {
      onBroadcastSession(currentSessionId || undefined);
    }

    setIsSharedFeedback(true);
    setTimeout(() => setIsSharedFeedback(false), 2000);
  }, [currentLocalUrl, activeUrl, onSetActiveUrl, onBroadcastSession, currentSessionId]);

  // 🎯 REJOINDRE LA SESSION D'UN AMI
  const handleJoinFriend = useCallback((member: any) => {
    if (!member?.sessionId) return;
    console.log('[SyncWatch] 🎯 Rejoindre la session de :', member.name);

    if (onJoinSession) {
      onJoinSession(member.sessionId);
    }

    setSelectedMember(null);
  }, [onJoinSession]);

  const getDisplayDomain = (url: string | null) => {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return null;
    }
  };

  const syncedMembers = members.filter((m) => m.sessionId === currentSessionId);
  const otherMembers = members.filter((m) => m.sessionId !== currentSessionId);
  const isAloneInSession = syncedMembers.length <= 1;

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
            className="flex items-center gap-1.5 bg-white/5 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400 px-3 py-1.5 rounded-full border border-white/5 hover:border-indigo-500/20 text-[9px] font-black uppercase tracking-widest transition-all duration-300 active:scale-95 cursor-pointer"
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
            className="flex items-center gap-1.5 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 px-3 py-1.5 rounded-full border border-white/5 hover:border-red-500/20 text-[9px] font-black uppercase tracking-widest transition-all duration-300 active:scale-95 cursor-pointer"
          >
            <LogOut size={10} />
            LEAVE
          </button>
        </div>
      </div>

      {/* ── SESSION & PRESENCE BAR ── */}
      <div className="px-5 py-2.5 bg-white/[0.01] border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Radio size={12} className={isAloneInSession ? 'text-indigo-400' : 'text-emerald-400 animate-pulse'} />
            <span className="text-[9px] text-slate-300 uppercase tracking-[0.2em] font-bold">
              {isAloneInSession ? 'Session (1 spectateur)' : `Session collective (${syncedMembers.length})`}
            </span>
          </div>

          {/* Members Avatars */}
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1.5">
              {members.map((m, i) => {
                const isWithMe = m.sessionId === currentSessionId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMember(m)}
                    title={`${m.name} : ${m.title || 'En navigation'} ${isWithMe ? '(Avec vous)' : '(Cliquer pour voir)'}`}
                    className={`w-5 h-5 rounded-full border border-[#020617] flex items-center justify-center text-[8px] font-black uppercase overflow-hidden transition-all duration-300 hover:scale-125 cursor-pointer ${
                      isWithMe
                        ? 'ring-1 ring-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.3)]'
                        : 'opacity-70 hover:opacity-100 ring-1 ring-indigo-500/40'
                    }`}
                    style={{
                      backgroundColor: `hsl(${(i * 137) % 360}, 60%, 40%)`,
                    }}
                  >
                    {m.name ? m.name.substring(0, 1) : '?'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          onClick={(e) => {
            navigator.clipboard.writeText(roomId);
            const target = e.currentTarget as HTMLElement;
            if (target) {
              const originalText = target.innerText;
              target.innerText = 'COPIED!';
              target.style.color = '#34d399';
              setTimeout(() => {
                target.innerText = originalText;
                target.style.color = '';
              }, 1000);
            }
          }}
          className="font-mono text-[11px] text-indigo-400 font-black tracking-tight hover:text-white transition-colors cursor-pointer active:scale-95"
          title="Copier le code du salon"
        >
          {roomId}
        </button>
      </div>

      {/* ── AUTRES SESSIONS EN LECTURE (Rejoindre en 1 clic) ── */}
      {otherMembers.length > 0 && (
        <div className="px-5 py-2 bg-indigo-950/20 border-b border-white/5 flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
            <Users size={11} className="text-indigo-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Autres sessions :</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            {otherMembers.map((m) => (
              <button
                key={m.id}
                onClick={() => handleJoinFriend(m)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300 border border-white/10 hover:border-emerald-500/30 text-[9px] font-medium transition-all shrink-0 active:scale-95 cursor-pointer"
                title={`Rejoindre ${m.name} (${m.title || 'Vidéo'})`}
              >
                <UserPlus size={10} className="text-emerald-400" />
                <span className="truncate max-w-[130px]">
                  Rejoindre {m.name} {m.title ? `· ${m.title}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── BROADCAST BAR ── */}
      <div className="px-5 py-2.5 bg-gradient-to-r from-indigo-950/30 via-slate-900/40 to-indigo-950/20 border-b border-white/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <Tv size={13} className="text-indigo-400 shrink-0" />
          <span className="text-[10px] font-semibold text-slate-400 truncate">
            {featuresState?.ytTitle || getDisplayDomain(currentLocalUrl || activeUrl) || 'En direct'}
          </span>
        </div>

        <button
          onClick={handleBroadcast}
          disabled={!currentLocalUrl && !activeUrl}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-300 shadow-md cursor-pointer shrink-0 active:scale-95 ${
            isSharedFeedback
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-emerald-500/20'
              : 'bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border border-indigo-500/30 hover:border-indigo-500/60 shadow-indigo-500/10'
          }`}
          title="Inviter tout le salon à regarder votre vidéo avec vous"
        >
          {isSharedFeedback ? (
            <>
              <Check size={11} className="text-emerald-400" />
              <span>Diffusé !</span>
            </>
          ) : (
            <>
              <Share2 size={11} className="text-indigo-300" />
              <span>Diffuser à tous</span>
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
        sessionActiveUrl={activeUrl}
        currentSessionId={currentSessionId}
        initialRoomState={initialRoomState}
        clockOffset={clockOffset}
        onSessionUrlChange={onSetActiveUrl}
      />

      {/* ── MODAL INFO MEMBRE ── */}
      {selectedMember && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 max-w-xs w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white">{selectedMember.name}</span>
              <button
                onClick={() => setSelectedMember(null)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1.5">
              <div className="text-[10px] uppercase font-bold text-slate-500">Actuellement :</div>
              <div className="p-2 bg-white/5 rounded-lg text-slate-200 truncate font-medium text-[11px]">
                {selectedMember.title || selectedMember.activeUrl || 'En navigation libre'}
              </div>
              <div className="text-[10px] text-slate-400">
                Statut : {selectedMember.sessionId === currentSessionId ? '🟢 Dans votre session' : '🟡 Dans une autre session'}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              {selectedMember.sessionId !== currentSessionId ? (
                <button
                  onClick={() => handleJoinFriend(selectedMember)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  Regarder avec lui
                </button>
              ) : (
                <span className="text-[10px] text-emerald-400 font-bold">Déjà synchronisé</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};