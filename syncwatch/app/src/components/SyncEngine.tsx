import React, { useEffect, useRef } from "react";
import { listenToServer, socket } from "../services/socket";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
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
    initialRoomState ? JSON.parse(JSON.stringify(initialRoomState)) : null,
  );
  const lastHeartbeatRef = useRef<number>(0);

  useEffect(() => {
    // --- 1. LECTURE DES ÉVÉNEMENTS DU PLUGIN ---
    const unlistenTauri = listen("player-update", (event: any) => {
      const { ts, fullState, isManual, ...restOfPayload } = event.payload;
      if (!fullState) return;

      // 1. MISE À JOUR UI
      const uiState = { ...restOfPayload, ...fullState };
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

          // 🧹 MISSION A : On attend la fermeture (WIPE)
          if (expected === null) {
            if (actual === null) {
              console.log("[SyncEngine] 🧹 Vidéo déchargée. Bouclier baissé.");
              expectedStateRef.current = undefined;
              isApplyingStateRef.current = false;
            }
            return; // ⛔ On bloque
          }

          if (actual === null) return; // La vidéo n'est pas encore montée

          // 🚦 LE VIGILE (La vidéo charge-t-elle ?)
          if (actual.seeking === true) {
            // console.log("⏳ Le Vigile bloque : la roue tourne...");
            return; // ⛔ On bloque tout.
          }

          // 🔎 LA CHECKLIST (L'image est là, est-ce la bonne ?)
          let isMissionAccomplished = true;

          // Arrondi intelligent pour le temps
          if (
            expected.time !== undefined &&
            Math.abs(expected.time - actual.time) > 1.0
          ) {
            isMissionAccomplished = false;

            // Relance automatique si YouTube fait la sourde oreille
            const now = Date.now();
            if (!expected.lastShot || now - expected.lastShot > 1000) {
              invoke("playback_control", {
                command: "APPLY_STATE",
                data: { media: { time: expected.time } },
              });
              expected.lastShot = now;
            }
          }
          // Égalité stricte pour la pause
          if (
            expected.paused !== undefined &&
            expected.paused !== actual.paused
          ) {
            isMissionAccomplished = false;
          }

          // 🏁 VALIDATION FINALE
          if (isMissionAccomplished) {
            console.log("[SyncEngine] ✅ Checklist remplie. Bouclier baissé.");
            expectedStateRef.current = undefined;
            isApplyingStateRef.current = false;
          }
        }

        return; // ⛔ QUOI QU'IL ARRIVE : Le bouclier empêche le code d'aller plus bas !
      }

      // ==========================================
      // 🧠 DIFFING & RÉSEAU (Le Bouclier est baissé)
      // ==========================================
      if (fullState.rules && !rulesRef.current)
        rulesRef.current = fullState.rules;

      const stateToDiff = { ...fullState, activePluginId };
      let patch = null;

      // 🚫 Filtre Anti-Pub pour les actions humaines
      if (!isAdActive) {
        // 🟢 L'ASTUCE ANTI-SPAM EST ICI :
        // Si c'est le "setInterval" (isManual = false), on aligne le temps en mémoire
        // avec le nouveau temps juste avant de faire le diff.
        // Comme ça, le diff ne voit aucun écart de temps, et ne tire pas de SEND_ACTION !
        if (!isManual && lastStateRef.current?.media && stateToDiff.media) {
          lastStateRef.current.media.time = stateToDiff.media.time;
        }

        patch = getIncrementalDiff(
          stateToDiff,
          lastStateRef.current,
          rulesRef.current,
        );
      }

      if (patch) {
        lastStateRef.current = JSON.parse(JSON.stringify(stateToDiff));
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
    const unlistenSocket = listenToServer((data: any) => {
      if (data.type === "MEMBERS_UPDATE")
        onMembersUpdate?.(data.members || []);

      if (
        ["JOIN_SUCCESS", "SYNC_ORDER", "NAVIGATE_TO_SOURCE"].includes(data.type)
      ) {
        let patch = data.initialState || data.data || data;
        patch = interpolatePatch(
          patch,
          rulesRef.current,
          data.ts,
          clockOffset,
          lastStateRef.current,
        );

        if (patch.activeUrl !== undefined && onNavigate)
          onNavigate(patch.activeUrl);
        if (data.type === "JOIN_SUCCESS" && data.members)
          onMembersUpdate?.(data.members);

        // 🛡️ PRÉPARATION DU BOUCLIER & DE LA CHECKLIST
        if (patch.media !== undefined) {
          isApplyingStateRef.current = true;
          expectedStateRef.current = patch.media; // C'est devenu ultra simple !
        }

        lastStateRef.current = deepMerge(lastStateRef.current || {}, patch);
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
