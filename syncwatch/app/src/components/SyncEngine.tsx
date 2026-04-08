import React, { useEffect, useRef } from 'react';
import { listenToServer, socket } from '../services/socket';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  roomId: string;
  isHost: boolean;
  onUpdate: (payload: any) => void;
}

export const SyncEngine: React.FC<Props> = ({ isHost, onUpdate }) => {
  const isSyncing = useRef(false);
  // On mémorise le dernier état envoyé pour comparer
  const lastSentState = useRef<{paused: boolean, time: number}>({ paused: false, time: 0 });

  useEffect(() => {
    let unlistenTauri: (() => void) | undefined;
    
    const setupTauriListener = async () => {
      try {
        unlistenTauri = await listen('player-update', (event: any) => {
          if (isSyncing.current) return;

          const fullState = event.payload;
          if (!fullState || !fullState.media) return;

          const newPaused = fullState.media.paused;
          const newTime = fullState.media.currentTime;

          // --- FILTRE INTELLIGENT ---
          let shouldBroadcast = false;

          if (isHost) {
            // Le Host arrose toujours pour maintenir la synchro
            shouldBroadcast = true;
          } else {
            // Le Guest ne parle que s'il se passe un truc important :
            const hasStatusChanged = newPaused !== lastSentState.current.paused;
            const hasJumped = Math.abs(newTime - lastSentState.current.time) > 2; // Saut de plus de 2s

            if (hasStatusChanged || hasJumped) {
              shouldBroadcast = true;
            }
          }

          if (shouldBroadcast) {
            socket.emit('BROADCAST_STATE', { payload: fullState, debugId: Math.random() });
            // On met à jour notre mémoire
            lastSentState.current = { paused: newPaused, time: newTime };
          }
          
          onUpdate(fullState);
        });
      } catch (err) {
        console.error('[SyncEngine] Failed to setup Tauri listener:', err);
      }
    };
    setupTauriListener();

    // SENS ENTRANT (inchangé)
    const unlistenSocket = listenToServer((data: any) => {
      if (data.type === 'SYNC_STATE') {
        const fullState = data.payload; 
        if (!fullState) return;

        isSyncing.current = true;
        invoke('playback_control', { command: 'APPLY_STATE', data: fullState }).catch(console.error);
        onUpdate(fullState);

        // On met aussi à jour lastSentState pour ne pas renvoyer ce qu'on vient de recevoir
        if (fullState.media) {
            lastSentState.current = { 
                paused: fullState.media.paused, 
                time: fullState.media.currentTime 
            };
        }

        setTimeout(() => { isSyncing.current = false; }, 1000);
      }
    });

    return () => {
        if (unlistenTauri) unlistenTauri();
        if (typeof unlistenSocket === 'function') unlistenSocket();
    };
  }, [isHost, onUpdate]); // On rajoute isHost ici pour que le filtre s'adapte si le host change

  return null; 
};