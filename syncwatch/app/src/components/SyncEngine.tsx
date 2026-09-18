import React, { useEffect, useRef } from "react";
import { listenToServer, socket } from "../services/socket";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  deepMerge,
  getIncrementalDiff,
  interpolatePatch,
  isSameMedia,
  SyncRule,
} from "../utils/syncHelpers";

interface SyncEngineProps {
  isHost?: boolean;
  onUpdate: (payload: any) => void;
  onMembersUpdate?: (members: any[]) => void;
  onNavigate?: (url: string) => void;
  activePluginId?: string | null;
  currentSessionId?: string | null;
  sessionActiveUrl?: string | null;
  initialRoomState?: any;
  clockOffset: number;
  onSessionUrlChange?: (url: string | null) => void;
}

/**
 * Moteur Client de Synchronisation SyncWatch.
 * Fait le pont bidirectionnel entre le Lecteur Local (Webview Tauri) et le Serveur Socket.io.
 * 
 * Responsabilités clés :
 * 1. Détection de Seek vs progression naturelle (getIncrementalDiff).
 * 2. Machine à états de convergence anti-écho (isApplyingStateRef / expectedStateRef).
 * 3. Compensation de latence réseau (Dead-Reckoning avec interpolatePatch).
 * 4. Détection et signalement de navigation vers une nouvelle vidéo.
 */
export const SyncEngine: React.FC<SyncEngineProps> = ({
  isHost: _isHost,
  onUpdate,
  onMembersUpdate,
  onNavigate,
  activePluginId,
  currentSessionId,
  sessionActiveUrl,
  initialRoomState,
  clockOffset,
  onSessionUrlChange,
}) => {
  // =========================================================================
  // REFS STABLES (Évite les déconnexions/reconnexions intempestives des listeners)
  // =========================================================================
  const currentSessionIdRef = useRef<string | null>(currentSessionId || null);
  currentSessionIdRef.current = currentSessionId || null;

  const clockOffsetRef = useRef<number>(clockOffset);
  clockOffsetRef.current = clockOffset;

  const activePluginIdRef = useRef<string | null>(activePluginId || null);
  activePluginIdRef.current = activePluginId || null;

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const onMembersUpdateRef = useRef(onMembersUpdate);
  onMembersUpdateRef.current = onMembersUpdate;

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const onSessionUrlChangeRef = useRef(onSessionUrlChange);
  onSessionUrlChangeRef.current = onSessionUrlChange;

  // =========================================================================
  // MACHINE À ÉTATS DE SYNCHRONISATION & CONVERGENCE
  // =========================================================================
  const expectedStateRef = useRef<any>(
    initialRoomState?.media !== undefined ? initialRoomState.media : null,
  );
  const isApplyingStateRef = useRef<boolean>(
    initialRoomState?.media !== undefined,
  );

  const rulesRef = useRef<Record<string, SyncRule> | null>(
    initialRoomState?.rules && Object.keys(initialRoomState.rules).length > 0
      ? initialRoomState.rules
      : null,
  );
  const lastStateRef = useRef<any>(
    initialRoomState ? structuredClone(initialRoomState) : null,
  );
  const lastStateTsRef = useRef<number>(initialRoomState?.ts || Date.now());
  const isLocalAdActiveRef = useRef<boolean>(false);
  const hasSyncedRulesToServerRef = useRef<boolean>(false);

  // URL du média localement actif dans la Webview
  const currentMediaUrlRef = useRef<string | null>(
    sessionActiveUrl || initialRoomState?.activeUrl || null,
  );

  // URL cible attendue suite à un ordre du serveur (Rejoindre une session / Broadcast)
  const expectedTargetUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionActiveUrl && !currentMediaUrlRef.current) {
      currentMediaUrlRef.current = sessionActiveUrl;
    }
  }, [sessionActiveUrl]);

  useEffect(() => {
    // =========================================================================
    // 1. RÉCEPTION DES RAPPORTS DU LECTEUR LOCAL (Tauri Webview -> React)
    // =========================================================================
    const unlistenTauri = listen("player-update", (event: any) => {
      const { ts, fullState, ...restOfPayload } = event.payload;
      if (!fullState) return;

      const currentLocalUrl = fullState.activeUrl || null;
      const stateToDiff = { ...fullState, activePluginId: activePluginIdRef.current };

      // Réception et mémorisation des règles déclarées par le plugin actif
      if (fullState.rules && Object.keys(fullState.rules).length > 0) {
        const wasEmpty = !rulesRef.current || Object.keys(rulesRef.current).length === 0;
        rulesRef.current = fullState.rules;

        // Synchronisation des règles vers le serveur à la première initialisation
        if (wasEmpty && currentSessionIdRef.current && !hasSyncedRulesToServerRef.current) {
          hasSyncedRulesToServerRef.current = true;
          socket.emit("SEND_ACTION", {
            sessionId: currentSessionIdRef.current,
            ts: Date.now() + clockOffsetRef.current,
            data: { rules: fullState.rules },
          });
        }
      }

      // Mise à jour de l'UI locale
      const uiState = {
        ...restOfPayload,
        ...fullState,
        sessionId: currentSessionIdRef.current,
      };

      if (fullState.media === null && expectedStateRef.current !== null) {
        uiState.media = lastStateRef.current?.media || null;
        uiState.activeUrl = lastStateRef.current?.activeUrl || null;
      }

      onUpdateRef.current(uiState);
      const wasAdActive = isLocalAdActiveRef.current;
      const isAdActive = !!fullState.features?.isAd;
      isLocalAdActiveRef.current = isAdActive;

      // 🔄 GESTION DU CHANGEMENT DE VIDÉO
      if (currentLocalUrl && !isSameMedia(currentLocalUrl, currentMediaUrlRef.current)) {
        const isExpected =
          expectedTargetUrlRef.current &&
          isSameMedia(currentLocalUrl, expectedTargetUrlRef.current);

        currentMediaUrlRef.current = currentLocalUrl;
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts;

        if (isExpected) {
          // Arrivée sur la vidéo ordonnée par la session : on laisse la machine converger
          console.log("[SyncEngine] 🎯 Arrivée sur la vidéo ordonnée :", currentLocalUrl);
          expectedTargetUrlRef.current = null;
          return;
        } else {
          // Navigation spontanée de l'utilisateur (clic sur une vidéo)
          console.log("[SyncEngine] 🔀 Navigation spontanée détectée vers :", currentLocalUrl);
          expectedStateRef.current = undefined;
          isApplyingStateRef.current = false;

          socket.emit("SEND_ACTION", {
            sessionId: currentSessionIdRef.current,
            ts: Date.now() + clockOffsetRef.current,
            data: {
              activeUrl: currentLocalUrl,
              features: { ytTitle: fullState.features?.ytTitle },
              media: fullState.media,
              rules: fullState.rules || rulesRef.current,
            },
          });

          // Sortie immédiate : pas de diff calculé sur la trame d'initialisation
          return;
        }
      }

      // Sortie de publicité : reprise automatique de l'état ordonné
      if (wasAdActive && !isAdActive && isApplyingStateRef.current && expectedStateRef.current) {
        const { lastShot, ...mediaOrder } = expectedStateRef.current as any;
        invoke("playback_control", {
          command: "APPLY_STATE",
          data: { media: mediaOrder },
        });
      }

      // 🛡️ MACHINE À ÉTATS : VÉRIFICATION DE LA CONVERGENCE
      // Quand le serveur ordonne un état, on attend que le lecteur physique l'ait atteint
      if (isApplyingStateRef.current && expectedStateRef.current !== undefined) {
        const expected = expectedStateRef.current;
        const actual = fullState.media;

        if (expected === null) {
          if (actual === null) {
            expectedStateRef.current = undefined;
            isApplyingStateRef.current = false;
          }
          return;
        }

        if (actual === null || isAdActive) return;

        const nowTs = Date.now();
        // Timeout de sécurité : après 2.5s, on libère le moteur pour ne jamais bloquer l'UI
        const initAge = nowTs - (expected.initTs || nowTs);
        if (initAge > 2500) {
          expectedStateRef.current = undefined;
          isApplyingStateRef.current = false;
          lastStateRef.current = structuredClone(stateToDiff);
          lastStateTsRef.current = ts;
          return;
        }

        let isMissionAccomplished = true;
        const isPlaying = !actual.paused;

        for (const key in expected) {
          if (key === "ts" || key === "lastShot" || key === "initTs") continue;
          const expectedVal = expected[key];
          const actualVal = actual[key];
          const path = `media.${key}`;
          const rule = rulesRef.current?.[path];

          if (rule?.type === "CONTINUOUS") {
            // En lecture, la cible temporelle avance avec le temps écoulé (Dead-Reckoning)
            const elapsed = Math.max(0, (nowTs - (expected.ts || nowTs)) / 1000);
            const speed = actual.playbackRate || expected.playbackRate || 1.0;
            const targetTime = isPlaying ? expectedVal + elapsed * speed : expectedVal;

            if (Math.abs(targetTime - actualVal) > 1.2) {
              isMissionAccomplished = false;
              break;
            }
          } else if (expectedVal !== actualVal) {
            isMissionAccomplished = false;
            break;
          }
        }

        if (!isMissionAccomplished) {
          // Relance si nécessaire (throttled à 1s)
          if (!expected.lastShot || nowTs - expected.lastShot > 1000) {
            const { ts: _t, lastShot: _ls, initTs: _it, ...mediaOrder } = expected;
            if (mediaOrder.time !== undefined && isPlaying) {
              const elapsed = Math.max(0, (nowTs - (expected.ts || nowTs)) / 1000);
              const speed = actual.playbackRate || expected.playbackRate || 1.0;
              mediaOrder.time = expected.time + elapsed * speed;
            }
            invoke("playback_control", {
              command: "APPLY_STATE",
              data: { media: mediaOrder },
            });
            expected.lastShot = nowTs;
          }
          return;
        }

        if (isMissionAccomplished) {
          lastStateRef.current = structuredClone(stateToDiff);
          lastStateTsRef.current = ts;
          expectedStateRef.current = undefined;
          isApplyingStateRef.current = false;
          return; // 🛑 Stabilisé sur l'ordre du serveur : ne jamais émettre d'écho !
        }
      }

      // Tant qu'on applique un ordre distant, on bloque toute émission de diff
      if (isApplyingStateRef.current) return;

      // =========================================================================
      // CALCUL DU DIFF INCRÉMENTAL & ÉMISSION SPONTANÉE
      // =========================================================================
      const stateForDiff = isAdActive ? { features: stateToDiff.features } : stateToDiff;
      const effectiveRules: Record<string, SyncRule> = {
        ...(rulesRef.current || {}),
        activeUrl: { type: "IGNORED" },
        rules: { type: "IGNORED" },
        activePluginId: { type: "IGNORED" },
      };

      const patch = getIncrementalDiff(
        stateForDiff,
        lastStateRef.current,
        effectiveRules,
        ts,
        lastStateTsRef.current,
      );

      // On aligne toujours la référence locale sur la trame actuelle pour ne pas fausser le prochain Seek
      lastStateRef.current = structuredClone(stateToDiff);
      lastStateTsRef.current = ts;

      if (patch) {
        console.log("[SyncEngine] 📤 Action utilisateur émise :", patch);
        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: patch,
        });
      }
    });

    // =========================================================================
    // 2. RÉCEPTION DES ORDRES DU SERVEUR SOCKET (Socket.io -> SyncEngine)
    // =========================================================================
    const unlistenSocket = listenToServer((packet: any) => {
      // 👥 Mise à jour de la topologie de la salle (Arrivée, départ, sessions)
      if (packet.type === "MEMBERS_UPDATE") {
        onMembersUpdateRef.current?.(packet.members || []);
        return;
      }

      let patch = null;

      if (packet.type === "JOIN_SUCCESS") {
        patch = packet.initialState;
        if (packet.members) onMembersUpdateRef.current?.(packet.members);
      } else if (packet.type === "SYNC_ORDER") {
        // 🔒 Filtrage local par session : on ignore les ordres des autres sessions
        if (
          packet.sessionId &&
          currentSessionIdRef.current &&
          packet.sessionId !== currentSessionIdRef.current
        ) {
          return;
        }
        patch = packet.data;
      }

      if (patch) {
        // Changement d'URL ordonné par la session (Rejoindre / Broadcast)
        if (patch.activeUrl && !isSameMedia(currentMediaUrlRef.current, patch.activeUrl)) {
          console.log("[SyncEngine] 🧭 Ordre de navigation vers l'URL :", patch.activeUrl);
          expectedTargetUrlRef.current = patch.activeUrl;
          currentMediaUrlRef.current = patch.activeUrl;
          onSessionUrlChangeRef.current?.(patch.activeUrl);

          if (onNavigateRef.current) {
            onNavigateRef.current(patch.activeUrl);
          }
        }

        // Interpolation temporelle de latence (Dead-Reckoning sur CONTINUOUS)
        patch = interpolatePatch(
          patch,
          rulesRef.current,
          packet.ts,
          clockOffsetRef.current,
          lastStateRef.current,
        );

        // Verrouillage de la machine de convergence
        if (patch.media !== undefined) {
          isApplyingStateRef.current = true;
          expectedStateRef.current = {
            ...patch.media,
            initTs: Date.now(),
            ts: Date.now(),
          };
        }

        lastStateRef.current = deepMerge(lastStateRef.current || {}, patch);
        lastStateTsRef.current = packet.ts ? packet.ts - clockOffsetRef.current : Date.now();

        // Application au lecteur local Webview
        if (!isLocalAdActiveRef.current) {
          invoke("playback_control", { command: "APPLY_STATE", data: patch });
        }

        onUpdateRef.current(patch);
      }
    });

    return () => {
      unlistenTauri.then((u) => u());
      unlistenSocket();
    };
  }, []);

  return null;
};
