import React, { useEffect, useState } from 'react';
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { socket } from '../services/socket';

export const LiveKitSidebar = ({ roomId }: { roomId: string }) => {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Demander le token au serveur Node.js via socket.io
    socket.emit("GET_LIVEKIT_TOKEN", (t: string) => {
      if (t) setToken(t);
    });
  }, [roomId]);

  if (!token) {
    return (
      <div className="p-4 text-xs text-slate-400 text-center animate-pulse">
        Connexion vocal en cours...
      </div>
    );
  }

  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token}
      serverUrl="https://livekit.beclay.fr"
      data-lk-theme="default"
      className="h-full w-full flex flex-col bg-[#020617]"
    >
      <VideoConference />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
};
