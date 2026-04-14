import { useState, useEffect } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { GroupDashboard } from './components/GroupDashboard';
import { WatchScreen } from './components/WatchScreen';
import { socket, listenToServer } from './services/socket';
import { invoke } from '@tauri-apps/api/core';

type AppState = 'HOME' | 'GROUP' | 'WATCH';

function App() {
  const [state, setState] = useState<AppState>('HOME');
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [activeUrl, setActiveUrl] = useState(''); // NOUVEAU
  const [activePluginId, setActivePluginId] = useState(''); // NOUVEAU




  useEffect(() => {
    const unbind = listenToServer((payload: any) => {
      if (payload.type === 'ROOM_CREATED') {
        setRoomId(payload.roomId);
        setIsHost(true);
        if (payload.members) setMembers(payload.members);
        setState('GROUP');

        invoke('set_view_mode', { mode: 'HOME' });

      } else if (payload.type === 'JOIN_SUCCESS') {
        setRoomId(payload.roomId);
        setIsHost(false);
        if (payload.members) setMembers(payload.members);
        invoke('set_view_mode', { mode: 'HOME' });

        if (payload.initialState?.activePluginId) {
          const pluginId = payload.initialState.activePluginId;
          setActivePluginId(pluginId);

          // ① Pré-synchronise le VirtualVideo avec l'état actuel de la room
          invoke('playback_control', {
            command: 'APPLY_STATE',
            data: payload.initialState
          });
          // ② Sauter directement en WATCH
          setState('WATCH');
        } else {

          // Pas encore de source active → page de choix
          setState('GROUP');
        }
      } else if (payload.type === 'MEMBERS_UPDATE') {
        setMembers(payload.members || []);
      } else if (payload.type === 'SYNC_ORDER') {
        // Suivi automatique de la navigation de l'Host si on est encore au menu
        if (state !== 'WATCH' && payload.activePluginId) {
          setActivePluginId(payload.activePluginId);
          if (payload.activeUrl) setActiveUrl(payload.activeUrl);
          setState('WATCH');
        }
      }
    });



    invoke('set_view_mode', { mode: 'HOME' });

    return () => {
        if (typeof unbind === 'function') unbind();
    };
  }, []);

  const handleCreateRoom = (name: string) => {
    socket.emit('CREATE_ROOM', { userName: name });
  };

  const handleJoinRoom = (id: string, name: string) => {
    setRoomId(id);
    socket.emit('JOIN_ROOM', { roomId: id, userName: name });
  };

  useEffect(() => {
    invoke('heartbeat').catch(console.error);
  }, []);

  const handleSelectSource = (targetUrl: string, pluginId: string) => {
    setActivePluginId(pluginId);
    invoke('set_view_mode', { mode: 'WATCH', url: targetUrl });
    setState('WATCH');
  };



  const handleStopWatching = () => {
    setState('GROUP');
    invoke('set_view_mode', { mode: 'GROUP' });
  };

  const handleLeave = () => {
    setState('HOME');
    setRoomId('');
    setIsHost(false);
    invoke('set_view_mode', { mode: 'HOME' });
  };

  const handleAutoNavigate = (targetUrl: string) => {
    if (!targetUrl || targetUrl === activeUrl) return;
    console.log('[SyncWatch] 🧭 Auto-navigating to:', targetUrl);
    setActiveUrl(targetUrl);
    if (state !== 'WATCH') setState('WATCH');
  };



  return (
    <div className="h-screen w-full overflow-hidden select-none bg-zinc-950 border-r border-white/5 shadow-2xl">
      {state === 'HOME' && (
        <HomeScreen onCreate={handleCreateRoom} onJoin={handleJoinRoom} />
      )}
      
      {state === 'GROUP' && (
        <GroupDashboard 
          roomId={roomId} 
          isHost={isHost} 
          members={members}
          onSelectSource={handleSelectSource} 
        />

      )}

      {state === 'WATCH' && (
        <WatchScreen 
           roomId={roomId} 
           isHost={isHost} 
           members={members}
           activeUrl={activeUrl}
           activePluginId={activePluginId}
           onLeave={handleLeave}
           onStop={handleStopWatching}
           onNavigate={handleAutoNavigate}
        />



      )}
    </div>
  );
}

export default App;
