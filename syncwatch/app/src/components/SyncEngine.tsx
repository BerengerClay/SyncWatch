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
    if (sessionActiveUrl && !currentMediaUrlRef.current && !expectedTargetUrlRef.current) {
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
      const isExpectingNavigation = !!expectedTargetUrlRef.current;
      const isUrlDifferent = !!(currentLocalUrl && !isSameMedia(currentLocalUrl, currentMediaUrlRef.current));

      if (isExpectingNavigation || isUrlDifferent) {
        // CAS 1 & 2 : On attend une navigation ordonnée par le serveur
        if (expectedTargetUrlRef.current) {
          if (isSameMedia(currentLocalUrl, expectedTargetUrlRef.current)) {
            // ⏳ URL correcte mais le <video> n'est pas encore monté dans le DOM
            // → On ne confirme PAS l'arrivée, sinon l'APPLY_STATE est silencieusement ignoré par le plugin
            if (!fullState.media) {
              console.log("[SyncEngine] ⏳ URL correcte mais vidéo pas encore montée, on attend...");
              return;
            }

            // ✅ Arrivée confirmée ET <video> présent → on peut appliquer l'état
            console.log("[SyncEngine] 🎯 Arrivée confirmée sur la vidéo ordonnée :", currentLocalUrl);
            currentMediaUrlRef.current = currentLocalUrl;
            onSessionUrlChangeRef.current?.(currentLocalUrl);
            expectedTargetUrlRef.current = null;

            // Réarmement du bouclier MAINTENANT (le <video> vient d'apparaître)
            if (expectedStateRef.current) {
              expectedStateRef.current.initTs = Date.now();
              expectedStateRef.current.lastShot = undefined;

              // Extraire les champs purement "media" pour l'APPLY_STATE (sans les métadonnées internes)
              const { lastShot: _ls, initTs: _it, ts: _ts, ...mediaOrder } = expectedStateRef.current as any;

              // Aligner la mémoire sur l'état ordonné (pas sur le 0s transitoire du player)
              lastStateRef.current = deepMerge(structuredClone(stateToDiff), { media: mediaOrder });
              lastStateTsRef.current = Date.now();

              invoke("playback_control", {
                command: "APPLY_STATE",
                data: { media: mediaOrder },
              });
            } else {
              lastStateRef.current = structuredClone(stateToDiff);
              lastStateTsRef.current = ts;
            }
            // 📢 Si on commence directement sur une pub, on notifie immédiatement le serveur
            // pour mettre en pause les autres membres de la session
            if (isAdActive && currentSessionIdRef.current) {
              console.log("[SyncEngine] 📢 Pub détectée à l'arrivée, notification de la session...");
              socket.emit("SEND_ACTION", {
                sessionId: currentSessionIdRef.current,
                ts: Date.now() + clockOffsetRef.current,
                data: { features: { isAd: true } },
              });
            }
          } else {
            // 🗑️ Trame résiduelle de l'ancien player pendant la navigation → ignorer
            console.log("[SyncEngine] 🗑️ Trame résiduelle ignorée :", currentLocalUrl);
          }
          return;
        }

        // CAS 3 : Aucune navigation attendue → navigation spontanée de l'utilisateur
        console.log("[SyncEngine] 🔀 Navigation spontanée détectée vers :", currentLocalUrl);
        currentMediaUrlRef.current = currentLocalUrl;
        onSessionUrlChangeRef.current?.(currentLocalUrl);
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts;
        expectedStateRef.current = undefined;
        isApplyingStateRef.current = false;

        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: {
            activeUrl: currentLocalUrl,
            media: fullState.media || undefined,
          },
        });
        return;
      }

      // Sortie de publicité : reprise automatique de l'état ordonné
      if (wasAdActive && !isAdActive && isApplyingStateRef.current && expectedStateRef.current) {
        expectedStateRef.current.initTs = Date.now();
        const { lastShot: _ls, initTs: _it, ts: _ts, ...mediaOrder } = expectedStateRef.current as any;
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
        } else if (actual !== null && !isAdActive) {
          // Si les règles ne sont pas encore chargées, on ne peut pas valider la convergence
          if (rulesRef.current && Object.keys(rulesRef.current).length > 0) {
            const nowTs = Date.now();
            // Timeout de sécurité : après 4s, on libère le moteur pour ne jamais bloquer l'UI
            const initAge = nowTs - (expected.initTs || nowTs);
            if (initAge > 4000) {
              console.warn("[SyncEngine] ⚠️ Timeout de convergence dépassé (4s), libération du bouclier");
              expectedStateRef.current = undefined;
              isApplyingStateRef.current = false;
              lastStateRef.current = structuredClone(stateToDiff);
              lastStateTsRef.current = ts;
            } else {
              let isMissionAccomplished = true;
              const isTargetPlaying = expected.paused !== undefined ? !expected.paused : !actual.paused;

              for (const key in expected) {
                if (key === "ts" || key === "lastShot" || key === "initTs") continue;
                const expectedVal = expected[key];
                const actualVal = actual[key];
                const path = `media.${key}`;
                const rule = rulesRef.current?.[path];

                // Ne vérifier que les champs avec une règle DISCRETE ou CONTINUOUS
                // Les champs IGNORED (duration, seeking) et inconnus ne doivent pas bloquer la convergence
                if (!rule || rule.type === "IGNORED") continue;

                if (rule.type === "CONTINUOUS") {
                  // En lecture, la cible temporelle avance avec le temps écoulé (Dead-Reckoning)
                  const elapsed = Math.max(0, (nowTs - (expected.ts || nowTs)) / 1000);
                  const speed = actual.playbackRate || expected.playbackRate || 1.0;
                  const targetTime = isTargetPlaying ? expectedVal + elapsed * speed : expectedVal;

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
                // Relance si nécessaire (throttled à 1s) — on n'envoie que les champs contrôlables
                if (!expected.lastShot || nowTs - expected.lastShot > 1000) {
                  const mediaOrder: any = {};
                  if (expected.paused !== undefined) mediaOrder.paused = expected.paused;
                  if (expected.playbackRate !== undefined) mediaOrder.playbackRate = expected.playbackRate;
                  if (expected.time !== undefined) {
                    if (isTargetPlaying) {
                      const elapsed = Math.max(0, (nowTs - (expected.ts || nowTs)) / 1000);
                      const speed = actual.playbackRate || expected.playbackRate || 1.0;
                      mediaOrder.time = expected.time + elapsed * speed;
                    } else {
                      mediaOrder.time = expected.time;
                    }
                  }
                  invoke("playback_control", {
                    command: "APPLY_STATE",
                    data: { media: mediaOrder },
                  });
                  expected.lastShot = nowTs;
                }
              } else {
                lastStateRef.current = structuredClone(stateToDiff);
                lastStateTsRef.current = ts;
                expectedStateRef.current = undefined;
                isApplyingStateRef.current = false;
              }
            }
          }
        }
      }

      // =========================================================================
      // CALCUL DU DIFF INCRÉMENTAL & ÉMISSION SPONTANÉE
      // =========================================================================
      // 🛡️ Si on applique un ordre ou si une pub est en cours, on bloque les diffs "media"
      // pour éviter les échos de seek/pause, mais on laisse toujours passer les "features" (ex: isAd).
      const shouldBlockMediaDiff = isApplyingStateRef.current || isAdActive;
      const stateForDiff = shouldBlockMediaDiff ? { features: stateToDiff.features } : stateToDiff;
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

      // On aligne la mémoire : si le média est protégé, on n'aligne que les features
      if (shouldBlockMediaDiff) {
        if (!lastStateRef.current) lastStateRef.current = {};
        lastStateRef.current.features = structuredClone(stateToDiff.features);
      } else {
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts;
      }

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

      // 🔑 Changement immédiat de session locale
      if (packet.type === "SESSION_CHANGED") {
        if (packet.sessionId) {
          console.log("[SyncEngine] 🔑 Session locale mise à jour :", packet.sessionId);
          currentSessionIdRef.current = packet.sessionId;
        }
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
        if (patch.rules && Object.keys(patch.rules).length > 0) {
          rulesRef.current = patch.rules;
        }

        let isNavigatingToNewUrl = false;

        // Changement d'URL ordonné par la session (Rejoindre / Broadcast)
        if (patch.activeUrl && !isSameMedia(currentMediaUrlRef.current, patch.activeUrl)) {
          console.log("[SyncEngine] 🧭 Ordre de navigation vers l'URL :", patch.activeUrl);
          isNavigatingToNewUrl = true;
          expectedTargetUrlRef.current = patch.activeUrl;

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
            ...(expectedStateRef.current || {}),
            ...patch.media,
            initTs: Date.now(),
            ts: Date.now(),
          };
        }

        lastStateRef.current = deepMerge(lastStateRef.current || {}, patch);
        lastStateTsRef.current = packet.ts ? packet.ts - clockOffsetRef.current : Date.now();

        // Application au lecteur local Webview
        // ⚠️ Si on vient d'ordonner une navigation, on ne seek pas l'ancienne vidéo !
        // L'état attendu est conservé dans expectedStateRef et s'appliquera dès l'arrivée sur la nouvelle vidéo.
        if (!isLocalAdActiveRef.current && !isNavigatingToNewUrl) {
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
