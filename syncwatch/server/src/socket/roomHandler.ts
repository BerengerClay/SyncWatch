import { Server, Socket } from "socket.io";
import { Room, SendActionPacket } from "../types/sync.js";
import {
  createRoom,
  joinRoom,
  joinSession,
  leaveSessionToLobby,
  broadcastSessionToRoom,
  handleVideoNavigation,
  updateSessionState,
  removeMember,
  getRoomBySocket,
  getAllRooms,
} from "../services/roomManager.js";
import {
  extrapolateSession,
  processReactions,
} from "../services/syncEngine.js";
import { monitor } from "../services/monitor.js";

// Re-export pour index.ts
export { getAllRooms };

/**
 * Contrôleur Socket.io des Salles et de la Synchronisation.
 * Reçoit les événements réseau, délègue aux services métiers, et gère la diffusion.
 */
export const setupRoomHandlers = (io: Server, socket: Socket) => {
  const getRoom = (): Room | null =>
    getRoomBySocket(socket.id, socket.rooms);

  // --- INTERCEPTEUR GLOBAL POUR LE DASHBOARD ADMIN ---
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

  /**
   * Diffuse les changements de présence et de structure du salon
   * (Arrivée, Départ, Changement de session)
   */
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
      data: {
        membersCount: room.members.length,
        sessionsCount: Object.keys(room.sessions).length,
      },
    });
    monitor.broadcastSnapshot(getAllRooms());
  };

  // =========================================================================
  // 1. CRÉATION DU SALON
  // =========================================================================
  socket.on("CREATE_ROOM", ({ userName }: { userName: string }) => {
    const { room, hostSessionId } = createRoom(socket.id, userName);

    socket.join(room.id);
    socket.emit("ROOM_CREATED", {
      roomId: room.id,
      hostId: socket.id,
      sessionId: hostSessionId,
      members: room.members,
      sessions: room.sessions,
    });

    broadcastMembers(room);
  });

  // =========================================================================
  // 2. REJOINDRE LE SALON (Toujours dans le lobby avec session vierge)
  // =========================================================================
  socket.on(
    "JOIN_ROOM",
    ({ roomId, userName }: { roomId: string; userName: string }) => {
      const result = joinRoom(roomId, socket.id, userName);
      if (!result) return socket.emit("ERROR", "Room not found");

      const { room, targetSessionId } = result;

      socket.join(roomId);
      socket.emit("JOIN_SUCCESS", {
        roomId,
        hostId: room.hostId,
        sessionId: targetSessionId,
        ts: Date.now(),
        initialState: null,
        members: room.members,
        sessions: room.sessions,
      });

      broadcastMembers(room);
      console.log(`[ROOM] User ${userName} (${socket.id}) joined room ${roomId} in lobby`);
    }
  );

  // =========================================================================
  // 3. REJOINDRE LA SESSION D'UN AMI ("Watch with")
  // =========================================================================
  socket.on("JOIN_SESSION", ({ sessionId }: { sessionId: string }) => {
    const room = getRoom();
    if (!room || !sessionId) return;

    const result = joinSession(room, socket.id, sessionId);
    if (!result) return;

    const { session } = result;
    const { state, ts } = extrapolateSession(session);

    socket.emit("SESSION_CHANGED", { sessionId });
    socket.emit("SYNC_ORDER", {
      sessionId,
      ts,
      data: {
        ...state,
        activeUrl: session.activeUrl,
      },
    });

    broadcastMembers(room);
  });

  // =========================================================================
  // 3b. QUITTER UNE SESSION POUR RETOURNER DANS LE LOBBY
  // =========================================================================
  socket.on("LEAVE_SESSION", () => {
    const room = getRoom();
    if (!room) return;

    const result = leaveSessionToLobby(room, socket.id);
    if (!result) return;

    socket.emit("SESSION_CHANGED", { sessionId: result.newSessionId });
    broadcastMembers(room);
    console.log(`[ROOM] User ${socket.id} returned to lobby (${result.newSessionId})`);
  });

  // =========================================================================
  // 4. DIFFUSER SA SESSION À TOUT LE SALON ("Regarder tous ensemble")
  // =========================================================================
  socket.on("BROADCAST_SESSION", (payload?: { sessionId?: string }) => {
    const room = getRoom();
    if (!room) return;

    const result = broadcastSessionToRoom(room, socket.id, payload?.sessionId);
    if (!result) return;

    const { targetSession, otherMembers } = result;
    const { state, ts } = extrapolateSession(targetSession);

    otherMembers.forEach((m) => {
      io.to(m.id).emit("SESSION_CHANGED", { sessionId: targetSession.id });
      io.to(m.id).emit("SYNC_ORDER", {
        sessionId: targetSession.id,
        ts,
        data: {
          ...state,
          activeUrl: targetSession.activeUrl,
        },
      });
    });

    broadcastMembers(room);
  });

  // =========================================================================
  // 5. DEMANDE DE SYNCHRO FRAÎCHE (Rattrapage volontaire)
  // =========================================================================
  socket.on("REQUEST_SYNC", (payload?: { sessionId?: string }) => {
    const room = getRoom();
    if (!room) return;

    const member = room.members.find((m) => m.id === socket.id);
    const sessionId = payload?.sessionId || member?.sessionId || room.defaultSessionId;
    const targetSession = room.sessions[sessionId];
    if (!targetSession) return;

    const { state, ts } = extrapolateSession(targetSession);
    socket.emit("SYNC_ORDER", {
      sessionId,
      ts,
      data: {
        ...state,
        activeUrl: targetSession.activeUrl,
      },
    });
  });

  // =========================================================================
  // 6. TRANSMISSION D'ACTIONS DANS UNE SESSION (Play, Pause, Seek, Video)
  // =========================================================================
  socket.on("SEND_ACTION", (packet: SendActionPacket) => {
    const room = getRoom();
    if (!room || !packet.data) return;

    const member = room.members.find((m) => m.id === socket.id);
    if (!member) return;

    let hasStructuralChange = false;

    // 🔄 Détection et gestion du changement de vidéo (scission de session)
    if (packet.data.activeUrl) {
      const prevUrl = member.activeUrl;
      const navResult = handleVideoNavigation(
        room,
        member,
        packet.data.activeUrl,
        packet.data.activePluginId,
        packet.data.state,
        packet.data.rules
      );

      if (navResult.isNewSession) {
        hasStructuralChange = true;
        socket.emit("SESSION_CHANGED", { sessionId: navResult.newSessionId });
        console.log(`[SESSION] 🔀 ${member.name} a créé la session ${navResult.newSessionId}`);

        monitor.recordStateChange({
          memberId: member.id,
          userName: member.name,
          roomId: room.id,
          sessionId: navResult.newSessionId,
          previousUrl: prevUrl,
          newUrl: packet.data.activeUrl,
          state: packet.data.state || member.state,
        });
      }
    }

    const sessionId = member.sessionId;
    const session = room.sessions[sessionId];
    if (!session) return;

    // Application du moteur de réactions (pubs collectives, etc.)
    const enhancedData = processReactions(
      packet.data,
      session.rules || {},
      room,
      sessionId,
      socket.id
    );

    // Mise à jour de la présence du membre
    if (packet.data.activeUrl !== undefined) member.activeUrl = packet.data.activeUrl;
    if (packet.data.state) {
      member.state = { ...(member.state || {}), ...packet.data.state };
    }

    // Mise à jour de l'état de la session
    updateSessionState(room, sessionId, enhancedData);

    // Diffusion de l'ordre de lecture à TOUTE la salle (y compris l'émetteur)
    io.to(room.id).emit("SYNC_ORDER", {
      sessionId,
      ts: session.lastUpdate,
      data: enhancedData,
    });

    monitor.logMessage({
      socketId: "server",
      roomId: room.id,
      direction: "OUT",
      event: "SYNC_ORDER",
      data: { sessionId, patch: enhancedData },
    });

    // MEMBERS_UPDATE n'est émis QUE s'il y a un changement de session/topologie
    if (hasStructuralChange) {
      broadcastMembers(room);
    } else {
      monitor.broadcastSnapshot(getAllRooms());
    }
  });

  // =========================================================================
  // 7. DÉCONNEXION D'UN UTILISATEUR
  // =========================================================================
  socket.on("disconnecting", () => {
    const changes = removeMember(socket.id, socket.rooms);
    changes.forEach(({ room, roomDeleted }) => {
      if (!roomDeleted) {
        broadcastMembers(room);
      }
    });
  });
};
