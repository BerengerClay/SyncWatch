import React, { useEffect, useRef } from "react";
import { listenToServer, socket } from "../services/socket";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  getValue,
  deepMerge,
  getIncrementalDiff,
  buildHeartbeatPayload,
  interpolatePatch,
} from "../utils/syncHelpers";

export const SyncEngine: React.FC<{
  isHost: boolean;
  onUpdate: (p: any) => void;
  onMembersUpdate?: (members: any[]) => void;
  onNavigate?: (url: string) => void;
  activePluginId?: string;
  initialRoomState?: any;
  clockOffset: number;
}> = ({
  isHost,
  onUpdate,
  onMembersUpdate,
  onNavigate,
  activePluginId,
  initialRoomState,
  clockOffset,
}) => {
  // 📝 LA CHECKLIST (Ce qu'on attend de la vidéo)
  const expectedStateRef = useRef<any>(
    initialRoomState?.media !== undefined ? initialRoomState.media : null,
  );

  // 🛡️ LE BOUCLIER (On le lève si on a une checklist au démarrage)
  const isApplyingStateRef = useRef<boolean>(
    initialRoomState?.media !== undefined,
  );

  const rulesRef = useRef<Record<string, any> | null>(
    initialRoomState?.rules || null,
  );
  const lastStateRef = useRef<any>(
    initialRoomState ? structuredClone(initialRoomState) : null,
  );
  const lastHeartbeatRef = useRef<number>(0);
  const lastStateTsRef = useRef<number>(initialRoomState?.ts || Date.now());

  useEffect(() => {
    // --- 1. LECTURE DES ÉVÉNEMENTS DU PLUGIN ---
    const unlistenTauri = listen("player-update", (event: any) => {
      const { ts, fullState, ...restOfPayload } = event.payload;
      if (!fullState) return;

      // 🟢 On prépare l'état de référence (Diffing + Baseline)
      const stateToDiff = { ...fullState, activePluginId };

      if (!rulesRef.current && fullState.rules) {
        rulesRef.current = fullState.rules;
      }

      // 1. MISE À JOUR UI
      const uiState = { ...restOfPayload, ...fullState };

      // si on charge une nouvelle vidéo le temps qu'elle charge, on met à jour l'état précédent pour éviter le flash noir
      if (fullState.media === null && expectedStateRef.current !== null) {
        uiState.media = lastStateRef.current?.media || null;
        uiState.activeUrl = lastStateRef.current?.activeUrl || null;
      }

      onUpdate(uiState);

      const isAdActive = fullState.features?.isAd === true;

      // ==========================================
      // 🛡️ LA MACHINE À ÉTATS (RÉSEAU UNIQUEMENT)
      // ==========================================
      if (isApplyingStateRef.current) {
        if (expectedStateRef.current !== undefined) {
          const expected = expectedStateRef.current;
          const actual = fullState.media;

          // quand on reçoit un sync order pour fermer une vidéo (expected === null) on attend que la vidéo soit fermée en local
          if (expected === null) {
            if (actual === null) {
              expectedStateRef.current = undefined;
              isApplyingStateRef.current = false;
            }
            return; // ⛔ On bloque
          }

          if (actual === null) return; // La vidéo n'est pas encore chargée

          // 🚦 LE VIGILE AGNOSTIQUE (La vidéo charge-t-elle ?)
          const isBlocked = Object.values(rulesRef.current || {}).some(
            (rule: any) => {
              if (rule.blockingIfKey) {
                const val = getValue(fullState, rule.blockingIfKey);
                return !!val;
              }
              return false;
            },
          );

          if (isBlocked) return; // ⛔ On bloque tout.

          // 🔎 LA CHECKLIST AGNOSTIQUE (L'image est là, est-ce la bonne ?)
          let isMissionAccomplished = true;

          for (const key in expected) {
            if (key === "ts" || key === "lastShot") continue;

            const expectedVal = expected[key];
            const actualVal = actual[key];
            const path = `media.${key}`;
            const rule = rulesRef.current?.[path];

            if (rule?.type === "CONTINUOUS") {
              if (Math.abs(expectedVal - actualVal) > 0.5) {
                isMissionAccomplished = false;
                break;
              }
            } else if (expectedVal !== actualVal) {
              isMissionAccomplished = false;
              break;
            }
          }

          // ⚡ RELANCE AUTOMATIQUE (Si la mission échoue, on ré-insiste)
          if (!isMissionAccomplished) {
            const now = Date.now();
            if (!expected.lastShot || now - expected.lastShot > 1000) {
              const { ts, lastShot, ...mediaOrder } = expected;
              invoke("playback_control", {
                command: "APPLY_STATE",
                data: { media: mediaOrder },
              });
              expected.lastShot = now;
            }
            return; // ⛔ On reste bloqué derrière le bouclier tant que c'est pas parfait
          }

          // 🏁 VALIDATION FINALE
          if (isMissionAccomplished) {
            // 🟢 RESET DE LA BASELINE : On repart sur l'état exact qu'on vient de valider
            lastStateRef.current = structuredClone(stateToDiff);
            lastStateTsRef.current = ts;

            expectedStateRef.current = undefined;
            isApplyingStateRef.current = false;
          }
        }

        return; // ⛔ QUOI QU'IL ARRIVE : Le bouclier empêche le code d'aller plus bas !
      }

      let patch = null;

      // 🚫 Filtre Anti-Pub pour les actions humaines
      if (!isAdActive) {
        patch = getIncrementalDiff(
          stateToDiff,
          lastStateRef.current,
          rulesRef.current,
          ts, // On envoie l'heure actuelle
          lastStateTsRef.current, // Et l'heure de la mémoire
        );
      }

      if (patch) {
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts; // 🟢 On met à jour l'horloge de référence
        socket.emit("SEND_ACTION", {
          ts: Date.now() + clockOffset,
          data: patch,
        });
        lastHeartbeatRef.current = Date.now();
      } else if (Date.now() - lastHeartbeatRef.current > 4500) {
        const hbData = buildHeartbeatPayload(fullState, rulesRef.current);
        if (isAdActive) hbData.media = { paused: true }; // Fantôme pendant la pub

        socket.emit("SEND_HEARTBEAT", { ts, data: hbData });
        lastHeartbeatRef.current = Date.now();
      }
    });

    // --- 2. RÉCEPTION DEPUIS LE SERVEUR ---
    const unlistenSocket = listenToServer((packet: any) => {
      if (packet.type === "MEMBERS_UPDATE") {
        onMembersUpdate?.(packet.members || []);
        return;
      }

      let patch = null;

      if (packet.type === "JOIN_SUCCESS") {
        patch = packet.initialState;
        if (packet.members) onMembersUpdate?.(packet.members);
      } else if (packet.type === "SYNC_ORDER") {
        patch = packet.data;
      }

      if (patch) {
        // 🧪 Interpolation & Réconciliation
        patch = interpolatePatch(
          patch,
          rulesRef.current,
          packet.ts,
          clockOffset,
          lastStateRef.current,
        );

        // 🧭 Navigation (Changement d'URL)
        if (patch.activeUrl !== undefined && onNavigate) {
          onNavigate(patch.activeUrl);
        }

        // 🛡️ ACTIVATION DU BOUCLIER (Si on change le temps ou la pause)
        if (patch.media !== undefined) {
          isApplyingStateRef.current = true;
          expectedStateRef.current = patch.media;
        }

        // 🧠 Mise à jour de la mémoire et du lecteur
        lastStateRef.current = deepMerge(lastStateRef.current || {}, patch);
        lastStateTsRef.current = packet.ts
          ? packet.ts - clockOffset
          : Date.now();

        invoke("playback_control", { command: "APPLY_STATE", data: patch });
        onUpdate(patch);
      }
    });

    return () => {
      unlistenTauri.then((u) => u());
      unlistenSocket();
    };
  }, [
    isHost,
    onUpdate,
    onMembersUpdate,
    onNavigate,
    activePluginId,
    clockOffset,
  ]);

  return null;
};
