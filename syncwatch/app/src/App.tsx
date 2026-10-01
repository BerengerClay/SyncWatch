import { useState, useEffect, useRef } from "react";
import { HomeScreen } from "./components/HomeScreen";
import { GroupDashboard } from "./components/GroupDashboard";
import { WatchScreen } from "./components/WatchScreen";
import { socket, listenToServer } from "./services/socket";
import { invoke } from "@tauri-apps/api/core";

type AppState = "HOME" | "GROUP" | "WATCH";

function App() {
  const [state, setState] = useState<AppState>("HOME");
  const [roomId, setRoomId] = useState("");
  const [myId, setMyId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<any>(null); // 🧠 Seed d'état pour le SyncEngine
  const [clockOffset, setClockOffset] = useState(0); // ⏱️ Différence entre serveur et local
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const stateRef = useRef<AppState>(state);
  stateRef.current = state;

  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  useEffect(() => {
    // Écouter les événements de création/jointure
    const unbind = listenToServer((payload: any) => {
      // ⏱️ Synchronisation de l'horloge
      if (payload.ts) {
        setClockOffset(payload.ts - Date.now());
      }

      if (payload.type === "ROOM_CREATED") {
        setRoomId(payload.roomId);
        if (payload.myId) setMyId(payload.myId);
        setIsHost(true);
        if (payload.members) setMembers(payload.members);
        if (payload.sessionId) {
          setCurrentSessionId(payload.sessionId);
          currentSessionIdRef.current = payload.sessionId;
        }
        setState("GROUP");

        invoke("set_view_mode", { mode: "HOME" });
      } else if (payload.type === "JOIN_SUCCESS") {
        setRoomId(payload.roomId);
        if (payload.myId) setMyId(payload.myId);
        setIsHost(false);
        if (payload.members) setMembers(payload.members);
        if (payload.sessionId) {
          setCurrentSessionId(payload.sessionId);
          currentSessionIdRef.current = payload.sessionId;
        }

        // Arrivée systématique sur le Dashboard (Option A)
        setState("GROUP");
        invoke("set_view_mode", { mode: "HOME" });
      } else if (payload.type === "SESSION_CHANGED") {
        if (payload.sessionId) {
          setCurrentSessionId(payload.sessionId);
          currentSessionIdRef.current = payload.sessionId;
        }
      } else if (payload.type === "MEMBERS_UPDATE") {
        if (payload.members) {
          setMembers((prev) => {
            return payload.members.map((newMember: any) => {
              const oldMember = prev.find((m) => m.id === newMember.id);
              return {
                ...newMember,
                activeUrl: newMember.activeUrl !== undefined ? newMember.activeUrl : oldMember?.activeUrl,
                state: newMember.activeUrl === null 
                  ? {} 
                  : (newMember.state !== undefined ? newMember.state : oldMember?.state),
              };
            });
          });
        }
      } else if (payload.type === "SYNC_ORDER") {
        const s = payload.data || payload;
        const orderSessionId = payload.sessionId;
        const senderId = payload.senderId;

        if (senderId && (s.state || s.activeUrl)) {
          setMembers((prev) => {
             return prev.map(m => {
               if (m.id === senderId) {
                 return {
                   ...m,
                   sessionId: orderSessionId || m.sessionId,
                   activeUrl: s.activeUrl !== undefined ? s.activeUrl : m.activeUrl,
                   state: s.state ? { ...(m.state || {}), ...s.state } : m.state
                 };
               }
               return m;
             });
          });
        }

        // Si l'on est au menu du salon (GROUP)
        if (stateRef.current !== "WATCH") {
          // On ne bascule en WATCH QUE si l'ordre concerne explicitement notre session
          // (ex: suite à un clic sur "Rejoindre" ou un BROADCAST)
          const isMySession =
            orderSessionId &&
            (orderSessionId === currentSessionIdRef.current || payload.isBroadcast);

          if (isMySession && s.activeUrl) {
            setRoomState(s);
            const plugin = s.activePluginId || "youtube";
            setActivePluginId(plugin);
            setActiveUrl(s.activeUrl);
            invoke("playback_control", {
              command: "APPLY_STATE",
              data: s,
            });
            invoke("set_view_mode", { mode: "WATCH", url: s.activeUrl });
            setState("WATCH");
          }
        }
      }
    });

    // S'assurer que le mode HOME est actif au démarrage
    invoke("set_view_mode", { mode: "HOME" });

    return () => {
      if (typeof unbind === "function") unbind();
    };
  }, []);

  const handleCreateRoom = (name: string) => {
    socket.emit("CREATE_ROOM", { userName: name });
  };

  const handleJoinRoom = (id: string, name: string) => {
    setRoomId(id);
    socket.emit("JOIN_ROOM", { roomId: id, userName: name });
  };

  useEffect(() => {
    // Test de connexion IPC au démarrage
    invoke("heartbeat").catch(console.error);
  }, []);

  const handleSelectSource = (targetUrl: string, pluginId: string) => {
    setActivePluginId(pluginId);
    setActiveUrl(null);
    invoke("set_view_mode", { mode: "WATCH", url: targetUrl });
    setState("WATCH");
  };

  const handleStopWatching = () => {
    setState("GROUP");
    setActiveUrl(null);
    invoke("set_view_mode", { mode: "HOME" });
    socket.emit("LEAVE_SESSION");
  };

  const handleLeave = () => {
    setState("HOME");
    setRoomId("");
    setIsHost(false);
    setActiveUrl(null);
    setActivePluginId(null);
    setCurrentSessionId(null);
    invoke("set_view_mode", { mode: "HOME" });
    socket.emit("LEAVE_ROOM");
  };

  const handleAutoNavigate = (targetUrl: string | null) => {
    if (!targetUrl) return;

    console.log("[SyncWatch] 🧭 Auto-navigating to:", targetUrl);
    setActiveUrl(targetUrl);
    invoke("set_view_mode", { mode: "WATCH", url: targetUrl });
    if (state !== "WATCH") setState("WATCH");
  };

  const handleJoinSession = (sessionId: string) => {
    console.log("[SyncWatch] 🎯 Joining session:", sessionId);
    setCurrentSessionId(sessionId);
    currentSessionIdRef.current = sessionId;
    socket.emit("JOIN_SESSION", { sessionId });
  };

  const handleBroadcastSession = (sessionId?: string) => {
    const target = sessionId || currentSessionId;
    if (target) {
      console.log("[SyncWatch] 📢 Broadcasting session to all members:", target);
      socket.emit("BROADCAST_SESSION", { sessionId: target });
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden select-none bg-zinc-950 border-r border-white/5 shadow-2xl">
      {state === "HOME" && (
        <HomeScreen onCreate={handleCreateRoom} onJoin={handleJoinRoom} />
      )}

      {state === "GROUP" && (
        <GroupDashboard
          roomId={roomId}
          isHost={isHost}
          members={members}
          currentSessionId={currentSessionId}
          myId={myId}
          onSelectSource={handleSelectSource}
          onJoinSession={handleJoinSession}
        />
      )}

      {state === "WATCH" && (
        <WatchScreen
          roomId={roomId}
          isHost={isHost}
          members={members}
          activeUrl={activeUrl}
          activePluginId={activePluginId}
          initialRoomState={roomState}
          clockOffset={clockOffset}
          currentSessionId={currentSessionId}
          myId={myId}
          onLeave={handleLeave}
          onStop={handleStopWatching}
          onNavigate={handleAutoNavigate}
          onSetActiveUrl={setActiveUrl}
          onJoinSession={handleJoinSession}
          onBroadcastSession={handleBroadcastSession}
        />
      )}
    </div>
  );
}

export default App;
