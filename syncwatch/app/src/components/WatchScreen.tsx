import React, { useState, useCallback } from 'react';
import { VideoView } from './VideoView';
import { Crown, Play, Pause, LogOut, Radio } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  onLeave: () => void;
}

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const WatchScreen: React.FC<Props> = ({ roomId, isHost, onLeave }) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [lastSeekTime, setLastSeekTime] = useState(0);

  const togglePlay = () => {
    if (isPlaying) {
      invoke('playback_control', { command: 'pause' });
    } else {
      invoke('playback_control', { command: 'play' });
    }
  };

  const handleTimeUpdate = useCallback((time: number) => {
    // Si on a cherché récemment (moins de 1.5s), on ignore les updates
    if (Date.now() - lastSeekTime < 1500) {
      console.log('[SyncWatch-SideBar] Ignoring update (cooldown)', time);
      return;
    }
    console.log('[SyncWatch-SideBar] Update current time:', time);
    setCurrentTime(time);
  }, [lastSeekTime]);

  const handleDurationUpdate = useCallback((d: number) => {
    setDuration(d);
  }, []);

  const handlePlayStateChange = useCallback((playing: boolean) => {
    setIsPlaying(playing);
  }, []);

  const handleSeekStart = () => {
    setIsDragging(true);
    setLocalTime(currentTime);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalTime(parseFloat(e.target.value));
  };

  const handleSeekEnd = () => {
    setIsDragging(false);
    setLastSeekTime(Date.now());
    setCurrentTime(localTime);
    invoke('playback_control', { command: 'seek', data: localTime });
  };

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

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">

        {/* Timecode Stage */}
        <div className="flex flex-col items-center gap-4 group w-full px-4">
          <span className="text-[9px] text-slate-600 uppercase tracking-[0.4em] font-black">TIMECODE</span>
          <div className="relative">
            <div className={`absolute -inset-8 bg-indigo-500/10 blur-[40px] rounded-full transition-opacity duration-1000 ${isPlaying ? 'opacity-100' : 'opacity-40'}`} />
            <span className="relative font-mono text-5xl font-black text-white tracking-tighter tabular-nums drop-shadow-[0_0_25px_rgba(255,255,255,0.15)] leading-none text-center">
              {formatTime(currentTime)}
            </span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full flex flex-col gap-2 mt-4">
            <div className="flex justify-between text-[10px] font-mono text-slate-500 font-bold px-1 uppercase tracking-widest">
              <span>{formatTime(isDragging ? localTime : currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <input 
              type="range"
              min={0}
              max={duration || 100}
              value={isDragging ? localTime : currentTime}
              onMouseDown={handleSeekStart}
              onChange={handleSeekChange}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
              className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.5)]"
            />
          </div>

          <div className="flex items-center gap-2 px-3 py-1 bg-white/[0.03] rounded-full border border-white/[0.05]">
            <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${isPlaying ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-slate-700'}`} />
            <span className={`text-[9px] font-black uppercase tracking-widest transition-colors duration-500 ${isPlaying ? 'text-emerald-400' : 'text-slate-600'}`}>
              {isPlaying ? 'Live Streaming' : 'Paused'}
            </span>
          </div>
        </div>

        {/* Control Orb */}
        <button
          onClick={togglePlay}
          className={`
            relative w-24 h-24 rounded-full flex items-center justify-center
            transition-all duration-500 active:scale-95 group
            ${isPlaying
              ? 'bg-slate-800/40 hover:bg-slate-700/60 border border-white/10 shadow-inner'
              : 'bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/50 shadow-[0_0_50px_rgba(99,102,241,0.3)]'
            }
          `}
        >
          <div className={`absolute inset-1 rounded-full border border-white/5 transition-transform duration-500 group-hover:scale-105 ${isPlaying ? 'scale-100' : 'scale-95'}`} />
          {isPlaying
            ? <Pause size={32} className="text-white/80 group-hover:text-white transition-colors" strokeWidth={2} />
            : <Play size={32} className="text-white ml-1.5 group-hover:scale-110 transition-all" strokeWidth={2.5} />
          }
        </button>

        {/* Info Card */}
        <div className="w-full glass-light rounded-[2rem] p-4 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">Network Status</span>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-400 leading-tight">
              {isHost ? 'Master Sync Active' : 'Synchronized with Master'}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-emerald-400/60 font-bold">24ms</span>
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between shrink-0 opacity-40 hover:opacity-100 transition-opacity duration-500">
        <span className="text-[8px] font-mono text-slate-500 uppercase tracking-[0.4em]">v0.4.0-BETA</span>
      </div>

      <VideoView
        roomId={roomId}
        isHost={isHost}
        onTimeUpdate={handleTimeUpdate}
        onDurationUpdate={handleDurationUpdate}
        onPlayStateChange={handlePlayStateChange}
      />
    </div>
  );
};
