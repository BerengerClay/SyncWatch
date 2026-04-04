import React from 'react';
import { Tv, Crown, MessageSquare, Settings, Share2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  onSelectSource: (source: 'YOUTUBE' | 'TF1') => void;
}

export const GroupDashboard: React.FC<Props> = ({ roomId, isHost, onSelectSource }) => {
  
  const sources = [
    { 
      id: 'YOUTUBE', 
      name: 'YouTube', 
      icon: <Tv size={28} />, 
      color: 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20 text-red-500', 
      available: true 
    },
    { 
      id: 'TF1', 
      name: 'TF1 Plus', 
      icon: <Tv size={28} />, 
      color: 'bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20 text-blue-500', 
      available: true 
    },
    { 
      id: 'NETFLIX', 
      name: 'Netflix', 
      icon: <Tv size={28} />, 
      color: 'bg-pink-500/5 border-white/5 text-slate-500 cursor-not-allowed', 
      available: false 
    }
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-[#020617] text-white p-10 font-sans overflow-hidden">
      
      {/* HEADER */}
      <div className="flex items-center justify-between mb-12 max-w-6xl mx-auto w-full">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
             <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
             <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Live Dashboard</span>
          </div>
          <h2 className="text-4xl font-black tracking-tight flex items-center gap-3 italic">
            Room <span className="text-indigo-400 font-mono tracking-tighter not-italic">{roomId}</span>
          </h2>
        </div>
        <div className="flex items-center gap-4">
           {isHost && (
             <span className="flex items-center gap-1.5 bg-amber-500/10 text-amber-500 px-6 py-3 rounded-full border border-amber-500/20 text-[10px] font-black uppercase tracking-widest">
               <Crown size={14} /> Master Node
             </span>
           )}
           <button className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all">
             <Share2 size={20} />
           </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-12 max-w-6xl mx-auto w-full flex-1">
        
        {/* SOURCES GRID */}
        <div className="col-span-8 space-y-6">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Select Stream Source</h3>
            <span className="text-[11px] font-medium text-slate-600 italic">2 Sources Available</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {sources.map(source => (
              <button
                key={source.id}
                disabled={!source.available}
                onClick={() => onSelectSource(source.id as any)}
                className={`
                  relative group flex flex-col items-start p-8 rounded-[2rem] border transition-all duration-500
                  ${source.color}
                `}
              >
                <div className="mb-6 p-4 bg-black/20 rounded-2xl group-hover:scale-110 transition-transform">
                  {source.icon}
                </div>
                <span className="text-xl font-black tracking-tight mb-1">{source.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                  {source.available ? 'Ready to Sync' : 'Coming Soon'}
                </span>
                
                {source.available && (
                  <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all">
                    <ArrowRight size={20} />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* QUICK CHAT / STATUS */}
          <div className="mt-8 p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                <MessageSquare size={24} />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black uppercase tracking-widest text-slate-400">Activity</span>
                <span className="text-xs text-slate-500">Awaiting stream selection...</span>
              </div>
            </div>
            <div className="flex -space-x-3">
               <div className="w-10 h-10 rounded-full border-2 border-[#020617] bg-indigo-600 flex items-center justify-center text-xs font-bold shadow-xl">Y</div>
               <div className="w-10 h-10 rounded-full border-2 border-[#020617] bg-emerald-600 flex items-center justify-center text-xs font-bold shadow-xl">J</div>
            </div>
          </div>
        </div>

        {/* SIDEBAR PANEL */}
        <div className="col-span-4 space-y-6">
          <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900 border border-indigo-500/30 rounded-3xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden group min-h-[250px]">
              <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:rotate-12 transition-transform">
                <Settings size={80} />
              </div>
              <div className="relative z-10 space-y-6">
                <h4 className="text-xl font-black tracking-tight leading-tight">Master Sync Control</h4>
                <p className="text-indigo-100/60 text-[11px] font-medium leading-relaxed uppercase tracking-widest">
                  Take control of the room. Manage users, settings, and playback permissions.
                </p>
                <button className="w-full bg-white text-indigo-950 font-black uppercase tracking-widest text-[10px] py-4 rounded-2xl shadow-xl hover:scale-[1.02] transition-all active:scale-95">
                  Open Room Settings
                </button>
              </div>
          </div>

          <div className="mt-auto pt-8 border-t border-slate-800">
            <button
               onClick={() => {
                invoke('set_view_mode', { mode: 'HOME' });
                window.location.reload();
              }}
              className="w-full justify-center p-5 text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-500/5 rounded-2xl border border-transparent hover:border-red-500/20 transition-all uppercase tracking-widest font-black flex items-center gap-2"
            >
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
              Reset Session
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

// Internal icon for consistency
const ArrowRight = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 12h14m-7-7 7 7-7 7" />
  </svg>
);
