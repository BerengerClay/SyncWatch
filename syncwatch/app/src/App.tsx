import { useState, useEffect } from "react";
import { HomeScreen } from "./components/HomeScreen";
import { GroupDashboard } from "./components/GroupDashboard";
import { WatchScreen } from "./components/WatchScreen";
import { socket, listenToServer } from "./services/socket";
import { invoke } from "@tauri-apps/api/core";

type AppState = "HOME" | "GROUP" | "WATCH";

function App() {
  const [state, setState] = useState<AppState>("HOME");
  const [roomId, setRoomId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [activeUrl, setActiveUrl] = useState<string | null>(null); // NOUVEAU
  const [activePluginId, setActivePluginId] = useState<string | null>(null); // NOUVEAU
  const [roomState, setRoomState] = useState<any>(null); // 🧠 Seed d'état pour le SyncEngine
  const [clockOffset, setClockOffset] = useState(0); // ⏱️ Différence entre serveur et local

  useEffect(() => {
    // Écouter les événements de création/jointure
    const unbind = listenToServer((payload: any) => {
      // ⏱️ Synchronisation de l'horloge
      if (payload.ts) {
        setClockOffset(payload.ts - Date.now());
      }

      if (payload.type === "ROOM_CREATED") {
        setRoomId(payload.roomId);
        setIsHost(true);
        if (payload.members) setMembers(payload.members);
        setState("GROUP");

        invoke("set_view_mode", { mode: "HOME" });
      } else if (payload.type === "JOIN_SUCCESS") {
        setRoomId(payload.roomId);
        setIsHost(false);
        if (payload.members) setMembers(payload.members);

        const initialState = payload.initialState || payload; // Fallback
        setRoomState(initialState);

        if (initialState?.activePluginId) {
          const pluginId = initialState.activePluginId;
          setActivePluginId(pluginId);

          invoke("playback_control", {
            command: "APPLY_STATE",
            data: initialState,
          });

          if (initialState.activeUrl) {
            invoke("set_view_mode", { 
              mode: "WATCH", 
              url: initialState.activeUrl 
            });
            setActiveUrl(initialState.activeUrl);
          }

          setState("WATCH");
        } else {
          setState("GROUP");
          invoke("set_view_mode", { mode: "HOME" });
        }
      } else if (payload.type === "MEMBERS_UPDATE") {
        setMembers(payload.members || []);
      } else if (payload.type === "SYNC_ORDER") {
        // Suivi automatique si l'on est au menu
        if (
          state !== "WATCH" &&
          (payload.activePluginId || payload.data?.activePluginId)
        ) {
          const s = payload.data || payload;
          setRoomState(s);
          setActivePluginId(s.activePluginId);
          if (s.activeUrl) {
            setActiveUrl(s.activeUrl);
            invoke("set_view_mode", { mode: "WATCH", url: s.activeUrl });
          }
          setState("WATCH");
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
    invoke("set_view_mode", { mode: "WATCH", url: targetUrl });
    setState("WATCH");
  };

  const handleStopWatching = () => {
    setState("GROUP");
    invoke("set_view_mode", { mode: "GROUP" });
  };

  const handleLeave = () => {
    setState("HOME");
    setRoomId("");
    setIsHost(false);
    invoke("set_view_mode", { mode: "HOME" });
  };

  const handleAutoNavigate = (targetUrl: string | null) => {
    if (targetUrl === activeUrl) return;

    console.log("[SyncWatch] 🧭 Auto-navigating to:", targetUrl);
    setActiveUrl(targetUrl);
    invoke("set_view_mode", { mode: "WATCH", url: targetUrl });
    if (state !== "WATCH") setState("WATCH");
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
          onSelectSource={handleSelectSource}
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
          onLeave={handleLeave}
          onStop={handleStopWatching}
          onNavigate={handleAutoNavigate}
        />
      )}
    </div>
  );
}

export default App;
