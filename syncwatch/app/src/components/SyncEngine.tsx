import React, { useEffect, useRef } from 'react';
import { listenToServer, socket } from '../services/socket';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// --- HELPERS AGNOSTIQUES ---
const getValue = (obj: any, path: string) => path.split('.').reduce((acc, part) => acc && acc[part], obj);
const setValue = (obj: any, path: string, value: any) => {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
};

export const SyncEngine: React.FC<{ isHost: boolean, onUpdate: (p: any) => void }> = ({ isHost, onUpdate }) => {
  const isSyncing = useRef(false);
  const rulesRef = useRef<Record<string, any> | null>(null);

  useEffect(() => {
    // --- SyncEngine.tsx ---
    const unlistenTauri = listen('player-update', (event: any) => {
      if (isSyncing.current) return;
      const { isPriority, ts, data, fullState, syncRules } = event.payload;
      if (!data) return;

      // 1. Administration des règles (Séparé)
      if (syncRules && !rulesRef.current) {
          rulesRef.current = syncRules; // TOUT LE MONDE mémorise les règles (Host et Guests)
          if (isHost) {
              socket.emit('SET_SYNC_RULES', syncRules); // SEUL le Host configure le serveur
          }
      }

      // --- Dans SyncEngine.tsx ---

      if (isPriority) {
          socket.emit('SEND_ACTION', { ts, data });
      } else {
          const minimalistData: any = {};
          
          if (rulesRef.current) {
              Object.keys(rulesRef.current).forEach(path => {
                  // 🎯 NOUVEAUTÉ : On n'inclut que le CONTINU dans le heartbeat
                  // Le DISCRET (paused, rate) attendra la prochaine ACTION pour être envoyé
                  if (rulesRef.current![path].type === 'CONTINUOUS') {
                      const val = getValue(data, path);
                      if (val !== undefined && val !== null) {
                          setValue(minimalistData, path, val);
                      }
                  }
              });
          }
          
          // Si la vidéo est en pause, minimalistData sera peut-être vide.
          // C'est parfait : on n'enverra que le "ts" pour dire qu'on est en vie.
          socket.emit('SEND_HEARTBEAT', { ts, data: minimalistData });
      }

      const uiPayload = {
        ...event.payload,        // Récupère ts, isPriority, sidebarCode, syncRules
        ...(fullState || data)   // Déballe media et features pour que props.media fonctionne
      };
      
      onUpdate(uiPayload);
    });

    const unlistenSocket = listenToServer((data: any) => {
      if (data.type === 'SYNC_ORDER' || data.type === 'JOIN_SUCCESS') {
        const state = data.initialState || data;
        isSyncing.current = true;
        invoke('playback_control', { command: 'APPLY_STATE', data: state });
        onUpdate(state);
        setTimeout(() => { isSyncing.current = false; }, 800);
      }
    });

    return () => { unlistenTauri.then(u => u()); unlistenSocket(); };
  }, [isHost, onUpdate]);

  return null;
};