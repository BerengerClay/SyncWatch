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
 * SyncEngine : Le Cœur Réseau & Synchronisation (Le chef d'orchestre)
 *
 * Rôle principal :
 * 1. Écouter le lecteur webview (via Tauri) pour détecter les actions locales de l'utilisateur.
 * 2. Écouter le serveur (via Socket.io) pour recevoir les actions des autres utilisateurs.
 * 3. Gérer la "Convergence Optimiste" : quand on reçoit un ordre réseau (ex: Pause),
 *    on ignore temporairement nos propres événements locaux pour éviter de boucler à l'infini (effet d'écho).
 *
 * Ce composant n'affiche aucune UI (il retourne `null`), c'est un pur moteur logique "en arrière-plan".
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

  /** Vérifie si un état hijacksPlayer est actif (ex: publicité en cours) */
  const checkPlayerHijacked = (state: any): boolean => {
    if (!rulesRef.current || !state) return false;
    for (const key in state) {
      if (rulesRef.current[key]?.hijacksPlayer && state[key]) return true;
    }
    return false;
  };

  // `expectedStateRef` : Ce qu'on ATTEND du lecteur vidéo après avoir reçu un ordre du serveur.
  // Tant que le lecteur local n'a pas atteint cet état (ex: time=12.5), on ignore les événements locaux contraires.
  const expectedStateRef = useRef<any>(
    initialRoomState?.state !== undefined ?
      {
        ...initialRoomState.state,
        ts:
          initialRoomState.lastUpdate ?
            initialRoomState.lastUpdate - clockOffset
          : Date.now(),
      }
    : null,
  );
  // Booléen pour savoir si on est actuellement en train d'appliquer un ordre externe
  const isApplyingStateRef = useRef<boolean>(
    initialRoomState?.state !== undefined,
  );

  // Les règles du plugin actuel (ex: YouTube) qui dictent comment chaque champ se synchronise
  const rulesRef = useRef<Record<string, SyncRule> | null>(
    initialRoomState?.rules && Object.keys(initialRoomState.rules).length > 0 ?
      initialRoomState.rules
    : null,
  );

  // `lastStateRef` : Le dernier état stable validé par le système. Sert de base de comparaison pour envoyer la différence (diff).
  const lastStateRef = useRef<any>(
    initialRoomState?.state ? structuredClone(initialRoomState.state) : null,
  );
  const lastStateTsRef = useRef<number>(initialRoomState?.ts || Date.now());
  const hasSyncedRulesToServerRef = useRef<boolean>(false);

  // Indique si le plugin a déjà renvoyé un rapport de lecture depuis le montage
  const hasReceivedFirstMediaUpdateRef = useRef<boolean>(false);
  // Indique s'il faut envoyer un state complet au prochain diff (ex: après une navigation)
  const needsFullStateOnNextDiffRef = useRef<boolean>(false);
  const fullStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMediaUrlRef = useRef<string | null>(
    sessionActiveUrl || initialRoomState?.activeUrl || null,
  );
  const expectedTargetUrlRef = useRef<string | null>(null);

  // Initialisation : si on rejoint une session qui a déjà une vidéo en cours,
  // on enregistre cette URL pour savoir qu'on ne fait pas une "nouvelle navigation".
  useEffect(() => {
    if (
      sessionActiveUrl &&
      !currentMediaUrlRef.current &&
      !expectedTargetUrlRef.current
    ) {
      expectedTargetUrlRef.current = sessionActiveUrl;
    }
  }, [sessionActiveUrl]);

  // =========================================================================
  // LE CŒUR DU RÉACTEUR : ÉCOUTE DES ÉVÉNEMENTS
  // =========================================================================
  useEffect(() => {
    // Le drapeau `isMounted` est vital. Il empêche les "Zombie Listeners" (Écouteurs fantômes).
    // Si React détruit ce composant, on lève le drapeau. Si Tauri tarde à couper l'écouteur,
    // ce drapeau bloquera l'envoi d'actions parasites (comme l'envoi de `time: 0` de l'ancienne vidéo).
    let isMounted = true;

    // 1. Écoute du Lecteur Webview (Tauri)
    // C'est ici qu'on reçoit l'état local du lecteur (pause, time, etc.) environ 10 à 20 fois par seconde.
    const unlistenTauri = listen("player-update", (event: any) => {
      if (!isMounted) return;
      const { ts, fullState, ...restOfPayload } = event.payload;
      if (!fullState) return;

      const currentLocalUrl = fullState.activeUrl || null;
      const stateToDiff = fullState.state || {};

      // Si on attend l'arrivée sur une nouvelle URL (ex: après un SYNC_ORDER),
      // les trames provenant de l'ancienne URL sont des "résidus" à ignorer.
      const isResidualFrame =
        expectedTargetUrlRef.current &&
        !isSameMedia(currentLocalUrl, expectedTargetUrlRef.current);

      if (isResidualFrame) {
        return; // Ignore complètement cette trame fantôme
      }

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
                ts: _ts,
                ...fullExpected
              } = expectedStateRef.current as any;

              const stateOrder: any = {};
              const nowTs = Date.now();
              for (const key in fullExpected) {
                const rule = rulesRef.current?.[key];
                if (rule?.type === "IGNORED" || rule?.controllable === false)
                  continue;

                if (rule?.type === "CONTINUOUS") {
                  const activeKey = rule.activeIfKey;
                  const isActiveTarget =
                    activeKey ?
                      fullExpected[activeKey] !== undefined ?
                        !!fullExpected[activeKey]
                      : true
                    : true;
                  const isTargetPlaying =
                    rule.activeInverted ? !isActiveTarget : isActiveTarget;

                  if (isTargetPlaying) {
                    const elapsed = Math.max(0, (nowTs - (expectedStateRef.current.ts || nowTs)) / 1000);
                    const speedKey = rule.speedKey;
                    const speed = speedKey ? (fullExpected[speedKey] || 1.0) : 1.0;
                    stateOrder[key] = fullExpected[key] + elapsed * speed;
                  } else {
                    stateOrder[key] = fullExpected[key];
                  }
                } else {
                  stateOrder[key] = fullExpected[key];
                }
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
        if (fullStateTimeoutRef.current) {
          clearTimeout(fullStateTimeoutRef.current);
        }
        fullStateTimeoutRef.current = setTimeout(() => {
          needsFullStateOnNextDiffRef.current = true;
        }, 1500);

        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: {
            activeUrl: currentLocalUrl,
            activePluginId: activePluginIdRef.current,
            // ASTUCE: On n'envoie délibérément aucun state ici.
            // Dans une SPA (comme YouTube), l'URL change avant le DOM.
            // Si on envoie le state, on fuite le temps de l'ancienne vidéo
            // dans la nouvelle session ! Le vrai state sera émis à la frame suivante.
          },
        });
        return;
      }

      // =========================================================================
      // VÉRIFICATION D'APPLICATION DES ORDRES (Convergence)
      // =========================================================================
      // Si on est en train d'appliquer un ordre (ex: le serveur a dit "Pause à 12s"),
      // on vérifie si notre lecteur local a bien atteint cet état.
      // Tant que ce n'est pas le cas, on bloque toute émission d'ordre contradictoire.
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
        }

        const isPlayerHijacked = checkPlayerHijacked(fullState.state);

        if (isPlayerHijacked) {
          // 🛡️ Pause le timer de convergence tant que le lecteur est hijacké (ex: pub)
          // expected.initTs = Date.now(); (removed)
        } else if (actual !== null) {
          if (rulesRef.current && Object.keys(rulesRef.current).length > 0) {
            const nowTs = Date.now();
            let isMissionAccomplished = true;
            const divergentKeys = new Set<string>();
            // On pré-calcule dynamiquement l'état "actif" pour les règles continues
            // au lieu d'utiliser des mots-clés hardcodés comme "paused"

            console.log(
              "[SyncEngine-DEBUG] Evaluating isMissionAccomplished. expected:",
              expected,
              "actual:",
              actual,
            );

            if (rulesRef.current) {
              for (const ruleKey in rulesRef.current) {
                // On bloque la convergence si l'état dit vrai OU si le plugin n'a pas encore eu le temps d'envoyer l'état (undefined)
                if (
                  rulesRef.current[ruleKey].preventsConvergence &&
                  (actual[ruleKey] === undefined || actual[ruleKey])
                ) {
                  console.log(
                    `[SyncEngine-DEBUG] isMissionAccomplished=false because convergence is prevented by ${ruleKey} (value: ${actual[ruleKey]})`,
                  );
                  isMissionAccomplished = false;
                  break;
                }
              }
            }

            for (const key in expected) {
              if (key === "ts" || key === "lastShot") continue;
              const expectedVal = expected[key];
              if (expectedVal === undefined) continue;

              const actualVal = actual[key];
              const rule = rulesRef.current?.[key];

              // Si la règle dit explicitement IGNORED ou controllable=false, on ignore pour la convergence
              if (rule?.type === "IGNORED" || rule?.controllable === false) {
                continue;
              }

              if (rule?.ignoreIfKey && expected[rule.ignoreIfKey]) {
                continue;
              }

              if (rule?.blockingIfKey && actual[rule.blockingIfKey]) {
                console.log(
                  `[SyncEngine-DEBUG] isMissionAccomplished=false because blocking key ${rule.blockingIfKey} is true`,
                );
                isMissionAccomplished = false;
                continue;
              }

              const isContinuous = rule?.type === "CONTINUOUS";

              if (isContinuous) {
                if (actualVal === undefined) {
                  console.log(
                    `[SyncEngine-DEBUG] isMissionAccomplished=false because actualVal for ${key} is undefined.`,
                  );
                  isMissionAccomplished = false;
                  divergentKeys.add(key);
                  continue;
                }
                const elapsed = Math.max(
                  0,
                  (nowTs - (expected.ts || nowTs)) / 1000,
                );
                const activeKey = rule.activeIfKey;
                const isActiveTarget =
                  activeKey ?
                    expected[activeKey] !== undefined ?
                      !!expected[activeKey]
                    : !!actual[activeKey]
                  : true;
                const isTargetPlayingForCalc =
                  rule.activeInverted ? !isActiveTarget : isActiveTarget;

                const speedKey = rule.speedKey;
                const speed =
                  speedKey ?
                    actual[speedKey] !== undefined ?
                      actual[speedKey]
                    : expected[speedKey] || 1.0
                  : 1.0;

                const targetTime =
                  isTargetPlayingForCalc ?
                    expectedVal + elapsed * speed
                  : expectedVal;

                console.log(
                  `[SyncEngine-DEBUG] Time calculation for ${key}: nowTs=${nowTs}, expected.ts=${expected.ts}, elapsed=${elapsed.toFixed(3)}s, speed=${speed}, isTargetPlaying=${isTargetPlayingForCalc}, expectedVal=${expectedVal}, targetTime=${targetTime.toFixed(3)}, actualVal=${actualVal.toFixed(3)}`,
                );

                // Tolérance dynamique: souple en lecture (absorbe le réseau), stricte en pause (précision absolue)
                const driftThreshold =
                  isTargetPlayingForCalc ? rule?.driftThreshold || 1.2 : 0.05;

                if (Math.abs(targetTime - actualVal) > driftThreshold) {
                  console.log(
                    `[SyncEngine-DEBUG] isMissionAccomplished=false because ${key} drift: Math.abs(${targetTime} - ${actualVal}) > ${driftThreshold}`,
                  );
                  isMissionAccomplished = false;
                  divergentKeys.add(key);
                }
              } else if (actualVal === undefined || expectedVal !== actualVal) {
                console.log(
                  `[SyncEngine-DEBUG] isMissionAccomplished=false because ${key} expected (${expectedVal}) !== actual (${actualVal})`,
                );
                isMissionAccomplished = false;
                divergentKeys.add(key);
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
                for (const key of divergentKeys) {
                  const rule = rulesRef.current?.[key];
                  if (rule?.type === "CONTINUOUS") {
                    const activeKey = rule.activeIfKey;
                    const isActiveTarget =
                      activeKey ?
                        expected[activeKey] !== undefined ?
                          !!expected[activeKey]
                        : !!actual[activeKey]
                      : true;
                    const isTargetPlaying =
                      rule.activeInverted ? !isActiveTarget : isActiveTarget;

                    if (isTargetPlaying) {
                      const elapsed = Math.max(
                        0,
                        (nowTs - (expected.ts || nowTs)) / 1000,
                      );
                      const speedKey = rule.speedKey;
                      const speed =
                        speedKey ?
                          actual[speedKey] !== undefined ?
                            actual[speedKey]
                          : expected[speedKey] || 1.0
                        : 1.0;
                      stateOrder[key] = expected[key] + elapsed * speed;
                    } else {
                      stateOrder[key] = expected[key];
                    }
                  } else {
                    stateOrder[key] = expected[key];
                  }
                }

                if (Object.keys(stateOrder).length > 0) {
                  console.log(
                    "[SyncEngine-DEBUG] Resending APPLY_STATE (only divergent keys):",
                    stateOrder,
                  );
                  invoke("playback_control", {
                    command: "APPLY_STATE",
                    data: { state: stateOrder },
                  });
                }
                expected.lastShot = nowTs;
              }
            }
          }
        }
      }

      // =========================================================================
      // CALCUL DU DIFF INCRÉMENTAL & ÉMISSION SPONTANÉE
      // =========================================================================
      // 🛡️ Blocage des échos réseau :
      // Quand on applique un ordre du serveur ou que le lecteur est hijacké (ex: par une pub),
      // on filtre temporairement les champs "contrôlables" (time, paused, playbackRate).
      // On autorise uniquement la synchronisation des données incontrôlables (ex: le titre de la vidéo),
      // pour éviter qu'une pub de 30s n'envoie "Pause" à tous les autres utilisateurs.
      const isPlayerHijackedLocal = checkPlayerHijacked(fullState.state);

      const shouldBlockControllableDiffs =
        isApplyingStateRef.current || isPlayerHijackedLocal;

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

      // Utilisation d'un algorithme intelligent pour ne détecter et n'envoyer
      // QUE les changements réels (ex: si seul "paused" passe de false à true).
      // Ça réduit massivement la bande passante et l'effet "spam".
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

      // ... (Si on vient de changer de page, on force l'envoi d'un état complet pour le nouveau spectateur)
      if (needsFullStateOnNextDiffRef.current) {
        console.log(
          "[SyncEngine] 🚀 Envoi d'un state complet suite à une navigation (différé)",
        );
        // Snapshot complet : on utilise stateToDiff (état brut du plugin)
        // et PAS stateForDiff qui a déjà été filtré par shouldBlockControllableDiffs
        // (ex: pendant une pub, time/paused sont retirés de stateForDiff).
        const rules = rulesRef.current || {};
        finalPatch = {};
        for (const key in stateToDiff) {
          if (rules[key]?.type === "IGNORED") continue;
          finalPatch[key] = stateToDiff[key];
        }
        needsFullStateOnNextDiffRef.current = false;
      }

      // 📤 SI on a trouvé des différences (finalPatch n'est pas vide), on les envoie au réseau
      if (finalPatch && Object.keys(finalPatch).length > 0) {
        console.log("[SyncEngine] 📤 Action utilisateur émise :", finalPatch);

        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: { state: finalPatch },
        });
      }
    });

    // 2. Écoute du Serveur (Socket.io)
    // C'est ici qu'on reçoit les ordres ("SYNC_ORDER") provenant des amis du salon.
    const unlistenSocket = listenToServer((packet: any) => {
      if (!isMounted) return;

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
          // Update currentMediaUrlRef to the new target URL so that the bootstrap
          // guard (lines 192-203) can properly match when the new media loads.
          // Without this, switching sessions while already in WATCH mode would
          // leave currentMediaUrlRef pointing to the OLD session's URL (e.g. TF1),
          // causing the guard to block indefinitely since "youtube.com" ≠ "tf1.fr".
          currentMediaUrlRef.current = patch.activeUrl;
          // Reset the first-media-update flag so the bootstrap guard will block
          // stale player-update events until the new media is loaded.
          hasReceivedFirstMediaUpdateRef.current = false;
          // Si on rejoint une nouvelle URL dictée par le serveur (ex: JOIN_SESSION),
          // on annule l'envoi de l'état complet local (prévu par une navigation précédente).
          needsFullStateOnNextDiffRef.current = false;
          if (fullStateTimeoutRef.current) {
            clearTimeout(fullStateTimeoutRef.current);
            fullStateTimeoutRef.current = null;
          }
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

        // Dès qu'on reçoit un "patch" d'un ami, on prépare la machine à appliquer l'ordre
        if (patch.state !== undefined) {
          isApplyingStateRef.current = true;
          expectedStateRef.current = {
            ...(expectedStateRef.current || {}),
            ...patch.state,
            ts: Date.now(),
          };

          lastStateRef.current = deepMerge(
            lastStateRef.current || {},
            patch.state,
          );
        }

        lastStateTsRef.current =
          packet.ts ? packet.ts - clockOffsetRef.current : Date.now();

        // 📥 Finalement, on donne l'ordre direct à Tauri/JS de bouger le lecteur
        if (patch.state !== undefined && !isNavigatingToNewUrl) {
          invoke("playback_control", {
            command: "APPLY_STATE",
            data: patch,
          });
        }

        onUpdateRef.current(patch);
      }
    });

    // Nettoyage impératif à la destruction du composant
    return () => {
      isMounted = false; // Lève le drapeau anti-fantômes
      if (fullStateTimeoutRef.current) {
        clearTimeout(fullStateTimeoutRef.current);
      }
      unlistenTauri.then((u) => u()); // Coupe le flux Tauri
      unlistenSocket(); // Coupe le flux Serveur
    };
  }, []);

  return null; // Pas d'UI
};
