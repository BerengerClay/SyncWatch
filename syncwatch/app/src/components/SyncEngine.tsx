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
 * Gère le "Field Locking" pour la convergence optimiste.
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
    initialRoomState?.state !== undefined ?
      {
        ...initialRoomState.state,
        ts: initialRoomState.lastUpdate ? initialRoomState.lastUpdate - clockOffset : Date.now(),
      }
    : null,
  );
  const isApplyingStateRef = useRef<boolean>(
    initialRoomState?.state !== undefined,
  );

  const rulesRef = useRef<Record<string, SyncRule> | null>(
    initialRoomState?.rules && Object.keys(initialRoomState.rules).length > 0 ?
      initialRoomState.rules
    : null,
  );
  const lastStateRef = useRef<any>(
    initialRoomState?.state ? structuredClone(initialRoomState.state) : null,
  );
  const lastStateTsRef = useRef<number>(initialRoomState?.ts || Date.now());
  const hasSyncedRulesToServerRef = useRef<boolean>(false);


  // Indique si le plugin a déjà renvoyé un rapport de lecture depuis le montage
  const hasReceivedFirstMediaUpdateRef = useRef<boolean>(false);
  // Indique s'il faut envoyer un state complet au prochain diff (ex: après une navigation)
  const needsFullStateOnNextDiffRef = useRef<boolean>(false);

  const currentMediaUrlRef = useRef<string | null>(
    sessionActiveUrl || initialRoomState?.activeUrl || null,
  );
  const expectedTargetUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      sessionActiveUrl &&
      !currentMediaUrlRef.current &&
      !expectedTargetUrlRef.current
    ) {
      currentMediaUrlRef.current = sessionActiveUrl;
    }
  }, [sessionActiveUrl]);

  useEffect(() => {
    const unlistenTauri = listen("player-update", (event: any) => {
      const { ts, fullState, ...restOfPayload } = event.payload;
      if (!fullState) return;

      const currentLocalUrl = fullState.activeUrl || null;
      const stateToDiff = fullState.state || {};

      if (fullState.rules && Object.keys(fullState.rules).length > 0) {
        const wasEmpty =
          !rulesRef.current || Object.keys(rulesRef.current).length === 0;
        rulesRef.current = fullState.rules;

        if (
          wasEmpty &&
          currentSessionIdRef.current &&
          !hasSyncedRulesToServerRef.current
        ) {
          hasSyncedRulesToServerRef.current = true;
          socket.emit("SEND_ACTION", {
            sessionId: currentSessionIdRef.current,
            ts: Date.now() + clockOffsetRef.current,
            data: { rules: fullState.rules },
          });
        }
      }

      const uiState = {
        ...restOfPayload,
        ...fullState,
        sessionId: currentSessionIdRef.current,
      };

      if (fullState.state === null && expectedStateRef.current !== null) {
        uiState.state = lastStateRef.current || null;
      }

      onUpdateRef.current(uiState);

      const isAdActive = !!fullState.state?.isAd;

      // =========================================================================
      // BOOTSTRAP & GESTION DES REDIRECTIONS DE CHARGEMENT
      // =========================================================================
      // Lorsque la Webview navigue vers une nouvelle session, l'URL peut temporairement
      // être incomplète (ex: https://www.youtube.com/ au lieu de /watch?v=...).
      // On bloque toute l'évaluation tant qu'on n'a pas atteint la bonne URL.
      if (
        isApplyingStateRef.current &&
        expectedStateRef.current &&
        !hasReceivedFirstMediaUpdateRef.current
      ) {
        if (isSameMedia(currentLocalUrl, currentMediaUrlRef.current)) {
          hasReceivedFirstMediaUpdateRef.current = true;
          expectedStateRef.current.initTs = Date.now();
        } else {
          // L'URL n'est pas encore la bonne, on attend la redirection.
          return;
        }
      }

      const isExpectingNavigation = !!expectedTargetUrlRef.current;
      const isUrlDifferent = !!(
        currentLocalUrl &&
        !isSameMedia(currentLocalUrl, currentMediaUrlRef.current)
      );

      if (isExpectingNavigation || isUrlDifferent) {
        if (expectedTargetUrlRef.current) {
          if (isSameMedia(currentLocalUrl, expectedTargetUrlRef.current)) {
            if (!fullState.state) {
              console.log(
                "[SyncEngine] ⏳ URL correcte mais vidéo pas encore montée, on attend...",
              );
              return;
            }
            console.log(
              "[SyncEngine] 🎯 Arrivée sur la vidéo cible confirmée !",
            );
            expectedTargetUrlRef.current = null;
            currentMediaUrlRef.current = currentLocalUrl;
            isApplyingStateRef.current = true;

            if (expectedStateRef.current) {
              expectedStateRef.current.initTs = Date.now();
              expectedStateRef.current.lastShot = undefined;

              const {
                lastShot: _ls,
                initTs: _it,
                ts: _ts,
                ...fullExpected
              } = expectedStateRef.current as any;

              const stateOrder: any = {};
              for (const key in fullExpected) {
                const rule = rulesRef.current?.[key];
                if (
                  rule?.type === "IGNORED" ||
                  rule?.controllable === false
                )
                  continue;
                stateOrder[key] = fullExpected[key];
              }

              lastStateRef.current = deepMerge(
                structuredClone(stateToDiff),
                fullExpected,
              );
              lastStateTsRef.current = Date.now();

              invoke("playback_control", {
                command: "APPLY_STATE",
                data: { state: stateOrder },
              });
            }
          } else {
            return; // Trame résiduelle, on attend
          }
          return; // Fin du traitement pour la frame d'arrivée
        }

        if (isUrlDifferent && !isApplyingStateRef.current) {
          console.log(
            `[SyncEngine] 🧭 Navigation détectée par le lecteur local : ${currentLocalUrl}`,
          );
        }
        currentMediaUrlRef.current = currentLocalUrl;
        onSessionUrlChangeRef.current?.(currentLocalUrl);
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts;
        expectedStateRef.current = undefined;
        isApplyingStateRef.current = false;

        // On force le prochain update (dans ~1.5s) à envoyer un state COMPLET.
        // On attend 1.5s pour être certain que la SPA (YouTube) a fini de charger
        // le nouveau DOM et que le plugin reporte bien l'état de la NOUVELLE vidéo.
        setTimeout(() => {
          needsFullStateOnNextDiffRef.current = true;
        }, 1500);

        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: {
            activeUrl: currentLocalUrl,
            // ASTUCE: On n'envoie délibérément aucun state ici.
            // Dans une SPA (comme YouTube), l'URL change avant le DOM.
            // Si on envoie le state, on fuite le temps de l'ancienne vidéo
            // dans la nouvelle session ! Le vrai state sera émis à la frame suivante.
          },
        });
        return;
      }

      if (
        isApplyingStateRef.current &&
        expectedStateRef.current !== undefined
      ) {
        const expected = expectedStateRef.current;
        const actual = fullState.state;

        if (expected === null) {
          if (actual === null) {
            expectedStateRef.current = undefined;
            isApplyingStateRef.current = false;
          }
        } else if (actual !== null && isAdActive) {
          // 🛡️ Pause le timer de convergence tant qu'une pub est en cours
          expected.initTs = Date.now();
        } else if (actual !== null && !isAdActive) {
          if (rulesRef.current && Object.keys(rulesRef.current).length > 0) {
              const nowTs = Date.now();
              let isMissionAccomplished = true;
              const isTargetPlaying =
                expected.paused !== undefined ?
                  !expected.paused
                : !actual.paused;

              console.log(
                "[SyncEngine-DEBUG] Evaluating isMissionAccomplished. expected:",
                expected,
                "actual:",
                actual,
              );

              if (actual.readyState === undefined || actual.readyState < 3) {
                console.log(
                  `[SyncEngine-DEBUG] isMissionAccomplished=false because video is buffering or not mounted (readyState: ${actual.readyState})`,
                );
                isMissionAccomplished = false;
              } else {
                for (const key in expected) {
                if (key === "ts" || key === "lastShot" || key === "initTs")
                  continue;
                const expectedVal = expected[key];
                if (expectedVal === undefined) continue;

                const actualVal = actual[key];
                const rule = rulesRef.current?.[key];
                
                // Si la règle dit explicitement IGNORED ou controllable=false, on ignore pour la convergence
                if (
                  rule?.type === "IGNORED" ||
                  rule?.controllable === false
                ) {
                  continue;
                }

                if (rule?.blockingIfKey && actual[rule.blockingIfKey]) {
                  console.log(
                    `[SyncEngine-DEBUG] isMissionAccomplished=false because blocking key ${rule.blockingIfKey} is true`,
                  );
                  isMissionAccomplished = false;
                  break;
                }

                const isContinuous = rule?.type === "CONTINUOUS" || key === "time";

                if (isContinuous) {
                  if (actualVal === undefined) {
                    console.log(
                      `[SyncEngine-DEBUG] isMissionAccomplished=false because actualVal for ${key} is undefined.`,
                    );
                    isMissionAccomplished = false;
                    break;
                  }
                  const elapsed = Math.max(
                    0,
                    (nowTs - (expected.ts || nowTs)) / 1000,
                  );
                  const speed =
                    actual.playbackRate || expected.playbackRate || 1.0;
                  const targetTime =
                    isTargetPlaying ?
                      expectedVal + elapsed * speed
                    : expectedVal;

                  console.log(
                    `[SyncEngine-DEBUG] Time calculation for ${key}: nowTs=${nowTs}, expected.ts=${expected.ts}, elapsed=${elapsed.toFixed(3)}s, speed=${speed}, isTargetPlaying=${isTargetPlaying}, expectedVal=${expectedVal}, targetTime=${targetTime.toFixed(3)}, actualVal=${actualVal.toFixed(3)}`
                  );

                  if (Math.abs(targetTime - actualVal) > 1.2) {
                    console.log(
                      `[SyncEngine-DEBUG] isMissionAccomplished=false because ${key} drift: Math.abs(${targetTime} - ${actualVal}) > 1.2`,
                    );
                    isMissionAccomplished = false;
                    break;
                  }
                } else if (
                  actualVal === undefined ||
                  expectedVal !== actualVal
                ) {
                  console.log(
                    `[SyncEngine-DEBUG] isMissionAccomplished=false because ${key} expected (${expectedVal}) !== actual (${actualVal})`,
                  );
                  isMissionAccomplished = false;
                  break;
                }
              }
            }

            if (isMissionAccomplished) {
                console.log(
                  "[SyncEngine-DEBUG] Mission Accomplished! Canceling lock.",
                );
                lastStateRef.current = structuredClone(stateToDiff);
                lastStateTsRef.current = ts;
                expectedStateRef.current = undefined;
                isApplyingStateRef.current = false;
              } else {
                if (!expected.lastShot || nowTs - expected.lastShot > 1000) {
                  const stateOrder: any = {};
                  for (const key in expected) {
                    if (key === "ts" || key === "lastShot" || key === "initTs")
                      continue;
                    const rule = rulesRef.current?.[key];
                    if (
                      rule?.type === "IGNORED" ||
                      rule?.controllable === false
                    )
                      continue;

                    if (key === "time" && isTargetPlaying) {
                      const elapsed = Math.max(
                        0,
                        (nowTs - (expected.ts || nowTs)) / 1000,
                      );
                      const speed =
                        actual.playbackRate || expected.playbackRate || 1.0;
                      stateOrder[key] = expected[key] + elapsed * speed;
                    } else {
                      stateOrder[key] = expected[key];
                    }
                  }
                  console.log(
                    "[SyncEngine-DEBUG] Resending APPLY_STATE:",
                    stateOrder,
                  );
                  invoke("playback_control", {
                    command: "APPLY_STATE",
                    data: { state: stateOrder },
                  });
                  expected.lastShot = nowTs;
                }
              }
            }
        }
      }

      // =========================================================================
      // CALCUL DU DIFF INCRÉMENTAL & ÉMISSION SPONTANÉE
      // =========================================================================
      // 🛡️ Quand on applique un ordre du serveur ou qu'une pub est en cours,
      // on bloque les diffs des champs contrôlables (time, paused, playbackRate)
      // pour éviter les échos de seek/pause. Seuls les champs readOnly (ex: isAd)
      // sont autorisés à passer — exactement comme l'ancien shouldBlockMediaDiff.
      const shouldBlockControllableDiffs =
        isApplyingStateRef.current || isAdActive;

      let stateForDiff: any;
      if (shouldBlockControllableDiffs) {
        stateForDiff = {};
        for (const key in stateToDiff) {
          const rule = rulesRef.current?.[key];
          if (rule?.controllable === false) {
            stateForDiff[key] = stateToDiff[key];
          }
        }
      } else {
        stateForDiff = stateToDiff;
      }

      const patch = getIncrementalDiff(
        stateForDiff,
        lastStateRef.current || {},
        rulesRef.current,
        ts,
        lastStateTsRef.current,
      );

      // Alignement mémoire : si les diffs contrôlables sont bloqués,
      // on n'aligne que les champs readOnly pour éviter l'accumulation de drift
      if (shouldBlockControllableDiffs) {
        if (!lastStateRef.current) lastStateRef.current = {};
        for (const key in stateToDiff) {
          const rule = rulesRef.current?.[key];
          if (rule?.controllable === false) {
            lastStateRef.current[key] = stateToDiff[key];
          }
        }
      } else {
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts;
      }

      let finalPatch = patch;
      if (needsFullStateOnNextDiffRef.current) {
        console.log(
          "[SyncEngine] 🚀 Envoi d'un state complet suite à une navigation (différé)",
        );
        finalPatch = { ...stateForDiff };
        needsFullStateOnNextDiffRef.current = false;
      }

      if (finalPatch && Object.keys(finalPatch).length > 0) {
        console.log("[SyncEngine] 📤 Action utilisateur émise :", finalPatch);

        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: { state: finalPatch },
        });
      }
    });

    const unlistenSocket = listenToServer((packet: any) => {
      if (packet.type === "MEMBERS_UPDATE") {
        onMembersUpdateRef.current?.(packet.members || []);
        return;
      }

      if (packet.type === "SESSION_CHANGED") {
        if (packet.sessionId) {
          currentSessionIdRef.current = packet.sessionId;
        }
        return;
      }

      let patch = null;

      if (packet.type === "JOIN_SUCCESS") {
        patch = packet.initialState;
        if (packet.members) onMembersUpdateRef.current?.(packet.members);
      } else if (packet.type === "SYNC_ORDER") {
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

        if (
          patch.activeUrl &&
          !isSameMedia(currentMediaUrlRef.current, patch.activeUrl)
        ) {
          isNavigatingToNewUrl = true;
          expectedTargetUrlRef.current = patch.activeUrl;
          if (onNavigateRef.current) {
            onNavigateRef.current(patch.activeUrl);
          }
        }

        if (patch.state) {
          patch.state = interpolatePatch(
            patch.state,
            rulesRef.current,
            packet.ts,
            clockOffsetRef.current,
            lastStateRef.current,
          );


        }

        if (patch.state !== undefined) {
          isApplyingStateRef.current = true;
          expectedStateRef.current = {
            ...(expectedStateRef.current || {}),
            ...patch.state,
            initTs: Date.now(),
            ts: Date.now(),
          };

          lastStateRef.current = deepMerge(
            lastStateRef.current || {},
            patch.state,
          );
        }

        lastStateTsRef.current =
          packet.ts ? packet.ts - clockOffsetRef.current : Date.now();

        if (patch.state !== undefined && !isNavigatingToNewUrl) {
          invoke("playback_control", {
            command: "APPLY_STATE",
            data: patch,
          });
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
