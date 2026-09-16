import React from 'react';
import { Tv, Crown, MessageSquare, Settings, Share2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  members: any[];
  onSelectSource: (targetUrl: string, pluginId: string) => void;
}




interface Plugin {
  name: string;
  homepage: string;
  color: string;
  script_filename: string;
}

export const GroupDashboard: React.FC<Props> = ({ roomId, isHost, members, onSelectSource }) => {


  const [plugins, setPlugins] = React.useState<Plugin[]>([]);

  React.useEffect(() => {
    invoke('get_plugins').then((res: any) => setPlugins(res)).catch(console.error);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-[#020617] text-white p-10 font-sans overflow-hidden">
      
      {/* HEADER */}
      <div className="flex items-center justify-between mb-12 max-w-6xl mx-auto w-full shrink-0">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
             <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
             <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Live Dashboard</span>
          </div>
          <h2 className="text-4xl font-black tracking-tight flex items-center gap-3 italic">
            Room <button 
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
              className="text-indigo-400 font-mono tracking-tighter not-italic hover:text-white transition-all cursor-pointer active:scale-95"
              title="Click to copy"
            >
              {roomId}
            </button>
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

      <div className="grid grid-cols-12 gap-12 max-w-6xl mx-auto w-full flex-1 overflow-hidden">
        
        {/* SOURCES GRID */}
        <div className="col-span-8 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4 px-1 shrink-0">
            <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Select Stream Source</h3>
            <span className="text-[11px] font-medium text-slate-600 italic">{plugins.length} Sources Available</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 overflow-y-auto pr-2 custom-scrollbar pb-6">
            {plugins.map((plugin, i) => (
              <button
                key={i}
                onClick={() => {
                  const pluginId = plugin.script_filename.replace('.js', '');
                  onSelectSource(plugin.homepage, pluginId);
                }}


                className={`
                  relative group flex flex-col items-start p-8 rounded-[2rem] border transition-all duration-500
                  ${plugin.color || 'bg-white/5 border-white/10 text-white'}
                `}
              >
                <div className="mb-6 p-4 bg-black/20 rounded-2xl group-hover:scale-110 transition-transform">
                  <Tv size={28} />
                </div>
                <span className="text-xl font-black tracking-tight mb-1">{plugin.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                   Ready to Sync
                </span>
                
                <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all">
                  <ArrowRight size={20} />
                </div>
              </button>
            ))}

            {/* Placeholder pour le futur */}
            <div className="flex flex-col items-center justify-center p-8 rounded-[2rem] border border-dashed border-white/5 bg-white/[0.01] opacity-40">
                <Settings size={24} className="mb-2" />
                <span className="text-[10px] font-black uppercase tracking-widest">Coming Soon</span>
            </div>
          </div>

          {/* QUICK CHAT / STATUS */}
          <div className="mt-auto p-8 bg-white/[0.02] border border-white/5 rounded-[2rem] flex items-center justify-between shrink-0">
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
              {members.slice(0, 6).map((m, i) => (
                <div 
                  key={m.id} 
                  title={m.name}
                  className="w-10 h-10 rounded-full border-2 border-[#020617] flex items-center justify-center text-xs font-bold shadow-xl uppercase"
                  style={{ backgroundColor: `hsl(${(i * 137) % 360}, 60%, 40%)` }}
                >
                  {m.name ? m.name.substring(0, 1) : '?'}
                </div>
              ))}
              {members.length > 6 && (
                <div className="w-10 h-10 rounded-full border-2 border-[#020617] bg-slate-900 flex items-center justify-center text-xs font-bold text-slate-500 shadow-xl">
                  +{members.length - 6}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* SIDEBAR PANEL */}
        <div className="col-span-4 flex flex-col gap-6 h-full">
          <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900 border border-indigo-500/30 rounded-3xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden group flex-1 min-h-[300px]">
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

          <div className="shrink-0 pt-8 border-t border-slate-800">
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
