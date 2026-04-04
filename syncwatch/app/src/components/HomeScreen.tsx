import React, { useState } from 'react';
import { Play, Plus, Users, ArrowRight } from 'lucide-react';

interface Props {
  onCreate: (name: string) => void;
  onJoin: (id: string, name: string) => void;
}

export const HomeScreen: React.FC<Props> = ({ onCreate, onJoin }) => {
  const [roomName, setRoomName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [userName, setUserName] = useState('');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#020617] text-white p-6 font-sans">
      <div className="max-w-md w-full space-y-12">
        
        {/* LOGO AREA */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-indigo-600 shadow-[0_0_50px_rgba(79,70,229,0.4)] mb-2">
            <Play size={40} fill="white" className="ml-1" />
          </div>
          <h1 className="text-5xl font-black tracking-tighter italic">SYNCWATCH</h1>
          <p className="text-slate-400 text-sm font-medium tracking-widest uppercase">Premium Watch Party Experience</p>
        </div>

        <div className="space-y-8 bg-white/[0.02] border border-white/5 p-8 rounded-[2.5rem] backdrop-blur-xl">
          
          {/* USERNAME */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 ml-1">Your Alias</label>
            <input 
              type="text" 
              placeholder="e.g. Maverick"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-2xl px-5 py-4 focus:border-indigo-500/50 outline-none transition-all font-medium text-lg placeholder:text-slate-600"
            />
          </div>

          <div className="grid grid-cols-1 gap-6">
            
            {/* CREATE */}
            <div className="space-y-3">
              <button 
                onClick={() => onCreate(userName || 'Anonymous')}
                disabled={!userName}
                className="w-full group relative flex items-center justify-between bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 p-5 rounded-2xl transition-all duration-300 overflow-hidden font-black uppercase tracking-widest text-xs"
              >
                <div className="flex items-center gap-3 relative z-10">
                  <Plus size={20} />
                  New Session
                </div>
                <ArrowRight size={20} className="relative z-10 opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all duration-300" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              </button>
            </div>

            <div className="relative flex items-center gap-4 py-2">
              <div className="flex-1 h-px bg-white/5" />
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">OR</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>

            {/* JOIN */}
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <input 
                  type="text" 
                  placeholder="Paste Room ID"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-2xl px-5 py-4 focus:border-indigo-500/50 outline-none transition-all font-mono text-center tracking-widest placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-600"
                />
                <button 
                  onClick={() => onJoin(joinId, userName || 'Anonymous')}
                  disabled={!userName || !joinId}
                  className="w-full flex items-center justify-center gap-3 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/5 p-5 rounded-2xl transition-all font-black uppercase tracking-widest text-xs"
                >
                  <Users size={20} />
                  Join Room
                </button>
              </div>
            </div>

          </div>
        </div>

        <div className="text-center opacity-30 text-[10px] font-mono tracking-widest uppercase">
          Build v0.5.0-BETA &bull; Secure Encrypted Tunnel
        </div>
      </div>
    </div>
  );
};
