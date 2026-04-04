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

  useEffect(() => {
    // Écouter les événements de création/jointure
    const unbind = listenToServer((payload: any) => {
      if (payload.type === 'ROOM_CREATED') {
        setRoomId(payload.roomId);
        setIsHost(true);
        setState('GROUP');
        invoke('set_view_mode', { mode: 'HOME' });
      } else if (payload.type === 'JOIN_SUCCESS') {
        setRoomId(payload.roomId);
        setIsHost(false);
        setState('GROUP');
        invoke('set_view_mode', { mode: 'HOME' });
      }
    });

    // S'assurer que le mode HOME est actif au démarrage
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
    // Test de connexion IPC au démarrage
    invoke('heartbeat').catch(console.error);
  }, []);

  const handleSelectSource = (source: 'YOUTUBE' | 'TF1') => {
    const url = source === 'YOUTUBE' ? 'https://www.youtube.com' : 'https://www.tf1.fr/';
    invoke('set_view_mode', { mode: 'WATCH', url });
    setState('WATCH');
  };

  const handleLeave = () => {
    setState('HOME');
    setRoomId('');
    setIsHost(false);
    invoke('set_view_mode', { mode: 'HOME' });
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
          onSelectSource={handleSelectSource} 
        />
      )}

      {state === 'WATCH' && (
        <WatchScreen 
           roomId={roomId} 
           isHost={isHost} 
           onLeave={handleLeave}
        />
      )}
    </div>
  );
}

export default App;
