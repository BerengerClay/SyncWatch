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
    initialRoomState?.state !== undefined ? initialRoomState.state : null,
  );
  const isApplyingStateRef = useRef<boolean>(
    initialRoomState?.state !== undefined,
  );

  const rulesRef = useRef<Record<string, SyncRule> | null>(
    initialRoomState?.rules && Object.keys(initialRoomState.rules).length > 0
      ? initialRoomState.rules
      : null,
  );
  const lastStateRef = useRef<any>(
    initialRoomState?.state ? structuredClone(initialRoomState.state) : null,
  );
  const lastStateTsRef = useRef<number>(initialRoomState?.ts || Date.now());
  const hasSyncedRulesToServerRef = useRef<boolean>(false);

  // Field Locking : Map des clés verrouillées avec leur timestamp d'expiration
  const lockedFieldsRef = useRef<Map<string, number>>(new Map());

  const currentMediaUrlRef = useRef<string | null>(
    sessionActiveUrl || initialRoomState?.activeUrl || null,
  );
  const expectedTargetUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionActiveUrl && !currentMediaUrlRef.current && !expectedTargetUrlRef.current) {
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
        const wasEmpty = !rulesRef.current || Object.keys(rulesRef.current).length === 0;
        rulesRef.current = fullState.rules;

        if (wasEmpty && currentSessionIdRef.current && !hasSyncedRulesToServerRef.current) {
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

      const isExpectingNavigation = !!expectedTargetUrlRef.current;
      const isUrlDifferent = !!(currentLocalUrl && !isSameMedia(currentLocalUrl, currentMediaUrlRef.current));

      if (isExpectingNavigation || isUrlDifferent) {
        if (expectedTargetUrlRef.current) {
          if (isSameMedia(currentLocalUrl, expectedTargetUrlRef.current)) {
            if (!fullState.state) {
              return;
            }

            currentMediaUrlRef.current = currentLocalUrl;
            onSessionUrlChangeRef.current?.(currentLocalUrl);
            expectedTargetUrlRef.current = null;

            if (expectedStateRef.current) {
              expectedStateRef.current.initTs = Date.now();
              expectedStateRef.current.lastShot = undefined;

              const { lastShot: _ls, initTs: _it, ts: _ts, ...stateOrder } = expectedStateRef.current as any;

              lastStateRef.current = deepMerge(structuredClone(stateToDiff), stateOrder);
              lastStateTsRef.current = Date.now();

              invoke("playback_control", {
                command: "APPLY_STATE",
                data: { state: stateOrder },
              });
            } else {
              lastStateRef.current = structuredClone(stateToDiff);
              lastStateTsRef.current = ts;
            }
            if (isAdActive && currentSessionIdRef.current) {
              socket.emit("SEND_ACTION", {
                sessionId: currentSessionIdRef.current,
                ts: Date.now() + clockOffsetRef.current,
                data: { state: { isAd: true } },
              });
            }
          }
          return;
        }

        currentMediaUrlRef.current = currentLocalUrl;
        onSessionUrlChangeRef.current?.(currentLocalUrl);
        lastStateRef.current = structuredClone(stateToDiff);
        lastStateTsRef.current = ts;
        expectedStateRef.current = undefined;
        isApplyingStateRef.current = false;
        lockedFieldsRef.current.clear();

        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: {
            activeUrl: currentLocalUrl,
            state: fullState.state || undefined,
          },
        });
        return;
      }

      if (isApplyingStateRef.current && expectedStateRef.current !== undefined) {
        const expected = expectedStateRef.current;
        const actual = fullState.state;

        if (expected === null) {
          if (actual === null) {
            expectedStateRef.current = undefined;
            isApplyingStateRef.current = false;
          }
        } else if (actual !== null && !isAdActive) {
          if (rulesRef.current && Object.keys(rulesRef.current).length > 0) {
            const nowTs = Date.now();
            const initAge = nowTs - (expected.initTs || nowTs);
            if (initAge > 4000) {
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
                const rule = rulesRef.current?.[key];

                if (!rule || rule.type === "IGNORED") continue;

                if (rule.type === "CONTINUOUS") {
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
                if (!expected.lastShot || nowTs - expected.lastShot > 1000) {
                  const stateOrder: any = {};
                  for (const key in expected) {
                     if (key === "ts" || key === "lastShot" || key === "initTs") continue;
                     const rule = rulesRef.current?.[key];
                     if (!rule || rule.type === "IGNORED") continue;
                     
                     if (key === "time" && isTargetPlaying) {
                        const elapsed = Math.max(0, (nowTs - (expected.ts || nowTs)) / 1000);
                        const speed = actual.playbackRate || expected.playbackRate || 1.0;
                        stateOrder[key] = expected[key] + elapsed * speed;
                     } else {
                        stateOrder[key] = expected[key];
                     }
                  }
                  invoke("playback_control", {
                    command: "APPLY_STATE",
                    data: { state: stateOrder },
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

      const patch = getIncrementalDiff(
        stateToDiff,
        lastStateRef.current || {},
        rulesRef.current,
        ts,
        lastStateTsRef.current,
      );

      if (patch && isApplyingStateRef.current && expectedStateRef.current) {
         for (const key in patch) {
            if (expectedStateRef.current[key] !== undefined) {
               delete patch[key];
            }
         }
      }

      lastStateRef.current = structuredClone(stateToDiff);
      lastStateTsRef.current = ts;

      if (patch && Object.keys(patch).length > 0) {
        const expiry = Date.now() + 2500;
        for (const key in patch) {
           lockedFieldsRef.current.set(key, expiry);
        }

        console.log("[SyncEngine] 📤 Action utilisateur émise :", patch);
        socket.emit("SEND_ACTION", {
          sessionId: currentSessionIdRef.current,
          ts: Date.now() + clockOffsetRef.current,
          data: { state: patch },
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

        if (patch.activeUrl && !isSameMedia(currentMediaUrlRef.current, patch.activeUrl)) {
          isNavigatingToNewUrl = true;
          expectedTargetUrlRef.current = patch.activeUrl;
          if (onNavigateRef.current) {
            onNavigateRef.current(patch.activeUrl);
          }
        }

        if (patch.state) {
           const filteredState: any = {};
           const now = Date.now();
           for (const key in patch.state) {
              const lockExpiry = lockedFieldsRef.current.get(key) || 0;
              if (now < lockExpiry) {
                 console.log(`[SyncEngine] 🛡️ Ignoré: champ ${key} est verrouillé par une action locale.`);
              } else {
                 filteredState[key] = patch.state[key];
              }
           }
           patch.state = filteredState;
           if (Object.keys(patch.state).length === 0) {
              delete patch.state;
           }
        }

        patch = interpolatePatch(
          patch,
          rulesRef.current,
          packet.ts,
          clockOffsetRef.current,
          lastStateRef.current,
        );

        if (patch.state !== undefined) {
          isApplyingStateRef.current = true;
          expectedStateRef.current = {
            ...(expectedStateRef.current || {}),
            ...patch.state,
            initTs: Date.now(),
            ts: Date.now(),
          };
          
          lastStateRef.current = deepMerge(lastStateRef.current || {}, patch.state);
        }

        lastStateTsRef.current = packet.ts ? packet.ts - clockOffsetRef.current : Date.now();

        if (patch.state !== undefined && !isNavigatingToNewUrl) {
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
