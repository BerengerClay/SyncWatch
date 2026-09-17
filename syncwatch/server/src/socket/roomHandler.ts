import { Server, Socket } from "socket.io";
import { monitor } from "../services/monitor.js";

const getValue = (obj: any, path: string) =>
  path.split(".").reduce((acc, part) => acc && acc[part], obj);

const setValue = (obj: any, path: string, value: any) => {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
};

const deepMerge = (target: any, source: any) => {
  if (!source) return target;
  if (!target) target = {};

  for (const key in source) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
};

export interface WatchSession {
  id: string;
  activeUrl: string | null;
  activePluginId: string | null;
  media: any;
  features: any;
  rules: Record<string, any>;
  lastUpdate: number;
}

export interface MemberPresence {
  id: string;
  name: string;
  sessionId: string;
  activeUrl?: string | null;
  title?: string;
  time?: number;
  paused?: boolean;
  isAd?: boolean;
}

export interface Room {
  id: string;
  hostId: string;
  defaultSessionId: string;
  members: MemberPresence[];
  sessions: Record<string, WatchSession>;
}

const rooms: Map<string, Room> = new Map();

export const getAllRooms = (): Room[] => Array.from(rooms.values());

export const setupRoomHandlers = (io: Server, socket: Socket) => {
  const getRoom = (): Room | null => {
    const roomId = Array.from(socket.rooms).find((r) => r !== socket.id);
    if (!roomId || typeof roomId !== "string") return null;
    return rooms.get(roomId) || null;
  };

  // Intercepteur de tous les messages entrants pour le Dashboard
  socket.onAny((event, ...args) => {
    if (event.startsWith("ADMIN_")) return;
    const room = getRoom();
    const member = room?.members.find((m) => m.id === socket.id);
    monitor.logMessage({
      socketId: socket.id,
      userName: member?.name,
      roomId: room?.id,
      direction: "IN",
      event,
      data: args[0],
    });
  });

  const broadcastMembers = (room: Room) => {
    io.to(room.id).emit("MEMBERS_UPDATE", {
      members: room.members,
      sessions: room.sessions,
    });
    monitor.logMessage({
      socketId: "server",
      roomId: room.id,
      direction: "OUT",
      event: "MEMBERS_UPDATE",
      data: { membersCount: room.members.length, sessionsCount: Object.keys(room.sessions).length },
    });
    monitor.broadcastSnapshot(getAllRooms());
  };

  const getExtrapolatedSession = (session: WatchSession) => {
    const now = Date.now();
    const timeDiff = (now - session.lastUpdate) / 1000;
    const extrapolatedState = JSON.parse(JSON.stringify(session));

    // Projection mathématique pour les données CONTINUOUS
    const rules = session.rules || {};
    Object.keys(rules).forEach((path) => {
      const rule = rules[path];
      if (rule.type === "CONTINUOUS") {
        const speed = rule.speedKey ? getValue(session, rule.speedKey) || 1 : 1;
        const active = rule.activeIfKey ? getValue(session, rule.activeIfKey) : true;
        if (rule.activeInverted ? !active : active) {
          const baseValue = getValue(session, path);
          if (typeof baseValue === "number") {
            const extrapolated = baseValue + timeDiff * speed;
            setValue(extrapolatedState, path, extrapolated);
          }
        }
      }
    });

    return { state: extrapolatedState, ts: now };
  };

  // --- 1. CRÉATION DU SALON ---
  socket.on("CREATE_ROOM", ({ userName }: { userName: string }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hostSessionId = `sess_${socket.id.substring(0, 6)}`;
    const initialSession: WatchSession = {
      id: hostSessionId,
      activeUrl: null,
      activePluginId: null,
      media: null,
      features: {},
      rules: {},
      lastUpdate: Date.now(),
    };

    const room: Room = {
      id: roomId,
      hostId: socket.id,
      defaultSessionId: hostSessionId,
      members: [
        {
          id: socket.id,
          name: userName || "Host",
          sessionId: hostSessionId,
          activeUrl: null,
          title: "En attente",
          paused: true,
          time: 0,
        },
      ],
      sessions: {
        [hostSessionId]: initialSession,
      },
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit("ROOM_CREATED", {
      roomId,
      hostId: socket.id,
      sessionId: hostSessionId,
      members: room.members,
      sessions: room.sessions,
    });
    broadcastMembers(room);
    console.log(`[ROOM] Created ${roomId} with host session ${hostSessionId}`);
  });

  // --- 2. REJOINDRE LE SALON ---
  socket.on(
    "JOIN_ROOM",
    ({ roomId, userName }: { roomId: string; userName: string }) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("ERROR", "Room not found");

      // Chaque nouveau membre commence dans sa propre session solo indépendante
      const guestSessionId = `solo_${socket.id.substring(0, 6)}`;
      const guestSession: WatchSession = {
        id: guestSessionId,
        activeUrl: null,
        activePluginId: null,
        media: null,
        features: {},
        rules: {},
        lastUpdate: Date.now(),
      };
      room.sessions[guestSessionId] = guestSession;

      room.members.push({
        id: socket.id,
        name: userName || "Invité",
        sessionId: guestSessionId,
        activeUrl: null,
        title: "En attente",
        paused: true,
        time: 0,
      });
      socket.join(roomId);

      socket.emit("JOIN_SUCCESS", {
        roomId,
        hostId: room.hostId,
        sessionId: guestSessionId,
        ts: Date.now(),
        initialState: null,
        members: room.members,
        sessions: room.sessions,
      });

      broadcastMembers(room);
      console.log(`[ROOM] User ${userName} (${socket.id}) joined room ${roomId} in session ${guestSessionId}`);
    }
  );

  // --- 3. CHANGEMENT DE VIDÉO PAR UN UTILISATEUR (Navigation spontanée) ---
  socket.on(
    "USER_NAVIGATED",
    (payload: {
      activeUrl: string;
      title?: string;
      activePluginId?: string | null;
      media?: any;
    }) => {
      const room = getRoom();
      if (!room || !payload?.activeUrl) return;

      const member = room.members.find((m) => m.id === socket.id);
      if (!member) return;

      const previousUrl = member.activeUrl;
      const isUrlChanged = payload.activeUrl !== previousUrl;

      // On vérifie s'il y a d'autres personnes dans la même session
      const othersInSession = room.members.filter(
        (m) => m.sessionId === member.sessionId && m.id !== socket.id
      );

      let targetSessionId = member.sessionId;

      if (othersInSession.length > 0) {
        // D'autres personnes regardaient ensemble dans cette session :
        // L'utilisateur se détache dans une nouvelle session solo pour ne pas perturber les autres !
        targetSessionId = `solo_${socket.id.substring(0, 6)}_${Date.now().toString(36)}`;
        member.sessionId = targetSessionId;
        socket.emit("SESSION_CHANGED", { sessionId: targetSessionId });
        monitor.logMessage({
          socketId: socket.id,
          userName: member.name,
          roomId: room.id,
          direction: "OUT",
          event: "SESSION_CHANGED",
          data: { sessionId: targetSessionId, reason: "detached_solo" },
        });
        console.log(`[SESSION] 🔀 ${member.name} s'est détaché dans une nouvelle session solo ${targetSessionId}`);
      }

      // Initialisation ou mise à jour de la session de ce membre
      room.sessions[targetSessionId] = {
        id: targetSessionId,
        activeUrl: payload.activeUrl,
        activePluginId: payload.activePluginId || "youtube",
        media: payload.media || { time: 0, paused: false },
        features: { ytTitle: payload.title },
        rules: room.sessions[targetSessionId]?.rules || {},
        lastUpdate: Date.now(),
      };

      member.activeUrl = payload.activeUrl;
      member.title = payload.title || "Vidéo en cours";
      if (payload.media?.time !== undefined) member.time = payload.media.time;
      if (payload.media?.paused !== undefined) member.paused = payload.media.paused;

      if (isUrlChanged) {
        monitor.recordMediaChange({
          memberId: member.id,
          userName: member.name,
          roomId: room.id,
          sessionId: targetSessionId,
          previousUrl,
          newUrl: payload.activeUrl,
          title: member.title,
          time: member.time,
          paused: member.paused,
        });
      }

      broadcastMembers(room);
    }
  );

  // --- 4. BASCULE EN MODE SOLO (Compatibilité) ---
  socket.on("SWITCH_TO_SOLO", (payload?: { activeUrl?: string; title?: string }) => {
    const room = getRoom();
    if (!room) return;

    const member = room.members.find((m) => m.id === socket.id);
    if (!member) return;

    const soloSessionId = `solo_${socket.id.substring(0, 6)}_${Date.now().toString(36)}`;
    member.sessionId = soloSessionId;
    if (payload?.activeUrl) member.activeUrl = payload.activeUrl;
    if (payload?.title) member.title = payload.title;

    room.sessions[soloSessionId] = {
      id: soloSessionId,
      activeUrl: payload?.activeUrl || null,
      activePluginId: null,
      media: null,
      features: { ytTitle: payload?.title },
      rules: {},
      lastUpdate: Date.now(),
    };

    socket.emit("SESSION_CHANGED", { sessionId: soloSessionId });
    broadcastMembers(room);
    console.log(`[SESSION] ${member.name} (${socket.id}) switched to solo session ${soloSessionId}`);
  });

  // --- 5. REJOINDRE LA SESSION D'UN AMI (Watch with) ---
  socket.on("JOIN_SESSION", ({ sessionId }: { sessionId: string }) => {
    const room = getRoom();
    if (!room || !sessionId) return;

    const targetSession = room.sessions[sessionId];
    if (!targetSession) return;

    const member = room.members.find((m) => m.id === socket.id);
    if (!member) return;

    member.sessionId = sessionId;
    member.activeUrl = targetSession.activeUrl;
    member.title = targetSession.features?.ytTitle;

    const { state, ts } = getExtrapolatedSession(targetSession);
    socket.emit("SESSION_CHANGED", { sessionId });
    socket.emit("SYNC_ORDER", {
      sessionId,
      ts,
      data: {
        ...state,
        activeUrl: targetSession.activeUrl,
      },
    });
    broadcastMembers(room);
    console.log(`[SESSION] 🤝 ${member.name} a rejoint la session ${sessionId} (${targetSession.activeUrl})`);
  });

  // --- 6. DIFFUSER SA SESSION À TOUT LE SALON ---
  socket.on("BROADCAST_SESSION", (payload?: { sessionId?: string }) => {
    const room = getRoom();
    if (!room) return;

    const member = room.members.find((m) => m.id === socket.id);
    if (!member) return;

    const targetSessionId = payload?.sessionId || member.sessionId;
    const targetSession = room.sessions[targetSessionId];
    if (!targetSession) return;

    room.defaultSessionId = targetSessionId;
    const otherMembers = room.members.filter((m) => m.id !== socket.id);

    otherMembers.forEach((m) => {
      m.sessionId = targetSessionId;
      m.activeUrl = targetSession.activeUrl;
      m.title = targetSession.features?.ytTitle;
    });

    const { state, ts } = getExtrapolatedSession(targetSession);

    // Envoi de l'ordre de synchronisation UNIQUEMENT aux autres membres (pas d'écho à l'émetteur)
    otherMembers.forEach((m) => {
      io.to(m.id).emit("SESSION_CHANGED", { sessionId: targetSessionId });
      io.to(m.id).emit("SYNC_ORDER", {
        sessionId: targetSessionId,
        ts,
        data: {
          ...state,
          activeUrl: targetSession.activeUrl,
        },
      });
    });

    broadcastMembers(room);
    console.log(`[SESSION] 📢 ${member.name} a diffusé sa session ${targetSessionId} à tous les membres`);
  });

  // --- 7. DEMANDE DE SYNCHRO FRAÎCHE (Rattrapage volontaire) ---
  socket.on("REQUEST_SYNC", (payload?: { sessionId?: string }) => {
    const room = getRoom();
    if (!room) return;

    const member = room.members.find((m) => m.id === socket.id);
    const sessionId = payload?.sessionId || member?.sessionId || room.defaultSessionId;
    const targetSession = room.sessions[sessionId];
    if (!targetSession) return;

    const { state, ts } = getExtrapolatedSession(targetSession);
    socket.emit("SYNC_ORDER", {
      sessionId,
      ts,
      data: {
        ...state,
        activeUrl: targetSession.activeUrl,
      },
    });
  });

  // --- 8. TRANSMISSION D'ACTIONS DANS UNE SESSION ---
  socket.on(
    "SEND_ACTION",
    (packet: { sessionId?: string; ts?: number; data: any }) => {
      const room = getRoom();
      if (!room || !packet.data) return;

      const member = room.members.find((m) => m.id === socket.id);
      if (!member) return;

      // AUTORITÉ DU SERVEUR : le socket agit TOUJOURS sur member.sessionId
      const sessionId = member.sessionId;

      let session = room.sessions[sessionId];
      if (!session) {
        session = {
          id: sessionId,
          activeUrl: member.activeUrl || null,
          activePluginId: null,
          media: null,
          features: {},
          rules: {},
          lastUpdate: Date.now(),
        };
        room.sessions[sessionId] = session;
      }

      // Application des règles et réactions au sein de la session
      const rules = session.rules || {};
      const enhancedData = { ...packet.data };

      const processReactions = (obj: any, parentPath = "") => {
        for (const key in obj) {
          const currentPath = parentPath ? `${parentPath}.${key}` : key;
          const val = obj[key];

          const rule = rules[currentPath];
          if (rule && rule.reactions) {
            let shouldApply = true;

            // Logique collective : on attend les membres de la même session
            if (rule.collective && val === false) {
              const anyoneElseInSession = room.members.some((m) => {
                if (m.id === socket.id || m.sessionId !== sessionId) return false;
                const keys = currentPath.split(".");
                let current: any = m;
                for (const k of keys) {
                  if (current && current[k] !== undefined) {
                    current = current[k];
                  } else {
                    return false;
                  }
                }
                return current === true;
              });
              if (anyoneElseInSession) shouldApply = false;
            }

            if (shouldApply) {
              const reaction = rule.reactions[String(val)];
              if (reaction) {
                Object.keys(reaction).forEach((targetPath) => {
                  setValue(enhancedData, targetPath, reaction[targetPath]);
                });
              }
            }
          }

          if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            processReactions(val, currentPath);
          }
        }
      };

      processReactions(packet.data);

      // Mise à jour de la session
      room.sessions[sessionId] = deepMerge(session, enhancedData);
      room.sessions[sessionId].lastUpdate = Date.now();

      // Mise à jour de la présence du membre
      if (packet.data.activeUrl !== undefined) {
        member.activeUrl = packet.data.activeUrl;
      }
      if (packet.data.features?.ytTitle) {
        member.title = packet.data.features.ytTitle;
      }
      if (packet.data.media?.time !== undefined) {
        member.time = packet.data.media.time;
      }
      if (packet.data.media?.paused !== undefined) {
        member.paused = packet.data.media.paused;
      }

      // Relais STRICTEMENT AUX AUTRES MEMBRES DE LA MÊME SESSION
      const peersInSession = room.members.filter(
        (m) => m.sessionId === sessionId && m.id !== socket.id
      );

      peersInSession.forEach((peer) => {
        io.to(peer.id).emit("SYNC_ORDER", {
          sessionId,
          ts: room.sessions[sessionId].lastUpdate,
          data: enhancedData,
        });
        monitor.logMessage({
          socketId: peer.id,
          userName: peer.name,
          roomId: room.id,
          direction: "OUT",
          event: "SYNC_ORDER",
          data: { sessionId, patch: enhancedData },
        });
      });

      broadcastMembers(room);
    }
  );

  // --- 9. DÉCONNEXION ---
  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        const room = rooms.get(roomId);
        if (room) {
          room.members = room.members.filter((m) => m.id !== socket.id);

          // Nettoyage des sessions orphelines sans aucun membre
          Object.keys(room.sessions).forEach((sId) => {
            const hasMembers = room.members.some((m) => m.sessionId === sId);
            if (!hasMembers && sId !== room.defaultSessionId) {
              delete room.sessions[sId];
            }
          });

          if (room.members.length === 0) {
            rooms.delete(roomId);
            console.log(`[ROOM] Room ${roomId} deleted (empty)`);
          } else {
            if (room.hostId === socket.id) {
              room.hostId = room.members[0].id;
            }
            broadcastMembers(room);
          }
        }
      }
    }
  });
};
