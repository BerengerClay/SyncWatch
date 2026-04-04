import React, { useEffect } from 'react';
import { listenToServer } from '../services/socket';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  onTimeUpdate: (time: number) => void;
  onDurationUpdate: (duration: number) => void;
  onPlayStateChange: (playing: boolean) => void;
}

export const VideoView: React.FC<Props> = ({ onTimeUpdate, onDurationUpdate, onPlayStateChange }) => {
  
  useEffect(() => {
    // 1. Écouter les mises à jour en TEMPS RÉEL venant du lecteur natif (via Rust IPC)
    let unlistenTauri: (() => void) | undefined;
    
    const setupTauriListener = async () => {
      try {
        const unlisten = await listen('player-update', (event: { payload: any }) => {
          const payload = event.payload;
          if (!payload) {
            console.warn('[SyncWatch-React] Received empty payload');
            return;
          }

          console.log('[SyncWatch-React] Data Received:', payload);

          const t = typeof payload.t === 'number' ? payload.t : 0;
          const d = typeof payload.d === 'number' ? payload.d : 0;
          const p = typeof payload.p === 'number' ? payload.p : 1;

          onTimeUpdate(t);
          onDurationUpdate(d);
          onPlayStateChange(p === 0);
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
  }, [onTimeUpdate, onDurationUpdate, onPlayStateChange]);

  return null; 
};
