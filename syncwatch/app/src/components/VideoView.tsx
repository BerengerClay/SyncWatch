import React, { useEffect } from 'react';
import { listenToServer } from '../services/socket';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  onUpdate: (payload: any) => void;
}

export const VideoView: React.FC<Props> = ({ onUpdate }) => {
  
  useEffect(() => {
    // 1. Écouter les mises à jour en TEMPS RÉEL venant du lecteur natif (via Rust IPC)
    let unlistenTauri: (() => void) | undefined;
    
    const setupTauriListener = async () => {
      try {
        console.log('[VideoView] 👂 Démarrage de l\'écouteur Tauri (player-update)...');
        const unlisten = await listen('player-update', (event: any) => {
          console.log('[VideoView] 🚀 Événement reçu:', event.event, event.payload);
          if (event.payload) {
            onUpdate(event.payload);
          }
        });
        unlistenTauri = unlisten;
      } catch (err) {
        console.error('[IPC] Failed to setup listener:', err);
      }
    };

    setupTauriListener();

    // 2. Écoute les commandes de synchro venant du serveur Socket
    const unlistenSocket = listenToServer((payload: any) => {
      switch (payload.type) {
        case 'SYNC_PLAY':
          invoke('playback_control', { command: 'play' });
          break;
        case 'SYNC_PAUSE':
          invoke('playback_control', { command: 'pause' });
          break;
        case 'SYNC_SEEK':
          invoke('playback_control', { command: 'seek', data: payload.currentTime });
          break;
      }
    });

    return () => {
        if (unlistenTauri) unlistenTauri();
        if (typeof unlistenSocket === 'function') unlistenSocket();
    };
  }, [onUpdate]);

  return null; 
};
