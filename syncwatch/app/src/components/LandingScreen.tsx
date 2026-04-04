import React, { useState } from 'react';
import { MonitorPlay, Plus, ArrowRight, Sparkles } from 'lucide-react';

interface Props {
  onCreate: () => void;
  onJoin: (id: string) => void;
}

export const LandingScreen: React.FC<Props> = ({ onCreate, onJoin }) => {
  const [roomId, setRoomId] = useState('');

  return (
    <div className="min-h-screen flex flex-col items-center justify-start bg-gradient-to-br from-[#0f172a] via-[#020617] to-[#1e1b4b] text-white p-6 font-sans overflow-hidden relative border-r border-white/5">
      
      {/* Decorative Blur Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[80%] h-[40%] bg-indigo-600/10 blur-[100px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[80%] h-[40%] bg-emerald-600/5 blur-[100px] rounded-full" />

      <div className="relative z-10 flex flex-col items-center w-full pt-10">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="p-3 bg-white/5 rounded-3xl border border-white/10 shadow-2xl backdrop-blur-xl group hover:scale-110 transition-transform duration-500">
            <MonitorPlay size={40} className="text-indigo-400 group-hover:text-indigo-300 transition-colors" />
          </div>
          <div className="flex flex-col items-center">
            <h1 className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60">
              SyncWatch
            </h1>
            <div className="flex items-center gap-2 mt-1 px-3 py-1 bg-indigo-500/10 rounded-full border border-indigo-500/20">
              <Sparkles size={10} className="text-indigo-400" />
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-indigo-300/80">Next-Gen Watch Party</span>
            </div>
          </div>
        </div>

        {/* Action Grid - Adjusted for 350px sidebar */}
        <div className="flex flex-col gap-4 w-full">
          {/* Create Card */}
          <button 
            onClick={onCreate} 
            className="group relative flex flex-col items-start p-6 rounded-[2rem] glass hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all duration-500 text-left overflow-hidden w-full"
          >
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Plus size={80} strokeWidth={3} />
            </div>
            
            <div className="mb-4 p-3 bg-indigo-500/10 rounded-xl text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300 shadow-xl">
              <Plus size={20} strokeWidth={3} />
            </div>
            <h2 className="text-xl font-bold mb-2">Host a Session</h2>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">Create a private virtual cinema and invite friends to watch together in sync.</p>
          </button>

          {/* Join Card */}
          <div className="flex flex-col p-6 rounded-[2rem] glass border-white/5 hover:border-indigo-500/30 transition-all duration-500 relative group overflow-hidden w-full">
             <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <ArrowRight size={80} strokeWidth={3} />
            </div>

            <h2 className="text-xl font-bold mb-6">Join a Session</h2>
            <div className="flex flex-col gap-4 relative">
              <div className="relative group/input">
                <input 
                  type="text"
                  placeholder="CODE"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-4 px-5 focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500/50 transition-all font-mono font-black text-lg tracking-[0.2em] placeholder:text-slate-700 placeholder:tracking-normal"
                />
                <button 
                  onClick={() => onJoin(roomId)} 
                  disabled={!roomId} 
                  className="absolute right-2 top-2 bottom-2 aspect-square bg-indigo-600 rounded-lg flex items-center justify-center hover:bg-indigo-500 disabled:opacity-0 disabled:scale-90 transition-all duration-300 shadow-lg shadow-indigo-500/20 active:scale-95"
                >
                  <ArrowRight size={18} strokeWidth={3} className="text-white" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 px-1 font-bold uppercase tracking-widest text-center">Format: 6-8 Alphanumeric</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="absolute bottom-6 left-0 w-full flex justify-center opacity-20">
         <span className="text-[8px] font-black tracking-[0.5em] uppercase text-slate-500 text-center">Electron Native x Intel Arc</span>
      </div>
    </div>
  );
};
