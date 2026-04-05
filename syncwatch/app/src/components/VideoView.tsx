import React, { useEffect } from 'react';
import { listenToServer, socket } from '../services/socket';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  onUpdate: (payload: any) => void;
}

export const VideoView: React.FC<Props> = ({ isHost, onUpdate }) => {
  useEffect(() => {
    // 1. SENS SORTANT (Ton Plugin -> Ton React & Tes Amis)
    let unlistenTauri: (() => void) | undefined;
    
    const setupTauriListener = async () => {
      try {
        unlistenTauri = await listen('player-update', (event: any) => {
          const fullState = event.payload;
          if (!fullState) return;

          // Si tu es le Host, tu arroses la room avec ton état
          if (isHost) {
            socket.emit('BROADCAST_STATE', fullState);
          }
          
          // Mise à jour de ta propre UI locale (WatchScreen)
          onUpdate(fullState);
        });
      } catch (err) {
        console.error('[VideoView] Failed to setup listener:', err);
      }
    };
    setupTauriListener();

    // 2. SENS ENTRANT (Serveur -> Ton Plugin)
    const unlistenSocket = listenToServer((data: any) => {
      if (data.type === 'SYNC_STATE') {
        const fullState = data.payload;
        // Si tu N'ES PAS le host, tu obéis à l'état reçu des autres
        if (!isHost && fullState) {
           invoke('playback_control', { command: 'APPLY_STATE', data: fullState });
           // On met aussi à jour l'UI React locale pour que le slider bouge
           onUpdate(fullState);
        }
      }
    });

    return () => {
        if (unlistenTauri) unlistenTauri();
        if (typeof unlistenSocket === 'function') unlistenSocket();
    };
  }, [isHost, onUpdate]);

  return null; 
};
