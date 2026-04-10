import React, { useEffect, useRef } from 'react';
import { listenToServer, socket } from '../services/socket';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// --- HELPERS ---
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

const deepMerge = (target: any, source: any): any => {
    const isObject = (item: any) => item && typeof item === 'object' && !Array.isArray(item);
    if (!isObject(target) || !isObject(source)) return source;
    const output = { ...target };
    Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
            if (!(key in target)) output[key] = source[key];
            else output[key] = deepMerge(target[key], source[key]);
        } else {
            output[key] = source[key];
        }
    });
    return output;
};

// 🛠️ NOUVEAU : Le Diffing est maintenant dans le réseau !
const getIncrementalDiff = (newObj: any, oldObj: any, rules: any, currentPath = ''): any => {
    if (!oldObj) return newObj;
    const patch: any = {};
    let hasChanged = false;

    for (const key in newObj) {
        const path = currentPath ? `${currentPath}.${key}` : key;
        const valNew = newObj[key];
        const valOld = oldObj[key];

        if (rules && rules[path]?.type === 'CONTINUOUS') continue;

        if (valNew !== null && typeof valNew === 'object' && !Array.isArray(valNew)) {
            const subPatch = getIncrementalDiff(valNew, valOld, rules, path);
            if (subPatch) { patch[key] = subPatch; hasChanged = true; }
        } else if (valNew !== valOld) {
            patch[key] = valNew;
            hasChanged = true;
        }
    }
    return hasChanged ? patch : null;
};

export const SyncEngine: React.FC<{ isHost: boolean, onUpdate: (p: any) => void }> = ({ isHost, onUpdate }) => {
  const isSyncing = useRef(false);
  const rulesRef = useRef<Record<string, any> | null>(null);
  const lastStateRef = useRef<any>(null); // 🧠 Mémoire du dernier envoi réseau
  const lastHeartbeatRef = useRef<number>(0); // ⏱️ Throttle pour les heartbeats réseau

  useEffect(() => {
    const unlistenTauri = listen('player-update', (event: any) => {
      if (isSyncing.current) return;
      console.log('[SyncWatch] 📥 Report received:', event.payload);
      const { ts, isManualTrigger, fullState, sidebarCode, syncRules } = event.payload;
      if (!fullState) return;

      // 1. Administration des règles
      if (syncRules && !rulesRef.current) {
          rulesRef.current = syncRules;
          if (isHost) socket.emit('SET_SYNC_RULES', syncRules);
      }

      // 2. Le Cerveau : Calcul de la priorité et du patch
      const patch = getIncrementalDiff(fullState, lastStateRef.current, rulesRef.current);
      const isPriority = isManualTrigger || patch !== null;

      if (isPriority) {
          // ACTION : On met à jour la mémoire et on envoie le patch
          lastStateRef.current = JSON.parse(JSON.stringify(fullState));
          socket.emit('SEND_ACTION', { ts, data: patch || fullState });
          lastHeartbeatRef.current = Date.now(); // On reset le timer car l'action fait office de heartbeat
      } else {
          // HEARTBEAT : On arrose le serveur à une fréquence réduite (ex: 5s)
          const now = Date.now();
          if (now - lastHeartbeatRef.current > 5000) {
              const minimalistData: any = {};
              if (rulesRef.current) {
                  Object.keys(rulesRef.current).forEach(path => {
                      const rule = rulesRef.current![path];
                      
                      if (rule.type === 'CONTINUOUS') {
                          // 🧠 NOUVEAU : On vérifie si la valeur est censée bouger en ce moment
                          let isActive = true;
                          if (rule.activeIfKey) {
                              const conditionValue = getValue(fullState, rule.activeIfKey);
                              isActive = rule.activeInverted ? !conditionValue : !!conditionValue;
                          }

                          // 🎯 On n'envoie la donnée QUE si elle est active (en train de changer)
                          if (isActive) {
                              const val = getValue(fullState, path);
                              if (val !== undefined && val !== null) {
                                  setValue(minimalistData, path, val);
                              }
                          }
                      }
                  });
              }
              socket.emit('SEND_HEARTBEAT', { ts, data: minimalistData });
              lastHeartbeatRef.current = now;
          }
      }

      // 3. Mise à jour de l'UI (Nettoyé !)
      // On extrait fullState, et on garde TOUT LE RESTE dans "restOfPayload"
      const { fullState: _ignored, ...restOfPayload } = event.payload; 

      const uiPayload = {
        ...restOfPayload, // Contient ts, sidebarCode, isManualTrigger...
        ...fullState      // Étale media et features proprement à la racine
      };
      
      onUpdate(uiPayload);
    });

    const unlistenSocket = listenToServer((data: any) => {
      if (data.type === 'SYNC_ORDER' || data.type === 'JOIN_SUCCESS') {
        const state = data.initialState || data;
        isSyncing.current = true;
        // Optionnel : on met aussi à jour la mémoire locale quand on reçoit un ordre
        lastStateRef.current = deepMerge(lastStateRef.current || {}, state);
        invoke('playback_control', { command: 'APPLY_STATE', data: state });
        onUpdate(state);
        setTimeout(() => { isSyncing.current = false; }, 800);
      }
    });

    return () => { unlistenTauri.then(u => u()); unlistenSocket(); };
  }, [isHost, onUpdate]);

  return null;
};