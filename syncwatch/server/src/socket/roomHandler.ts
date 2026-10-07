import { Server, Socket } from "socket.io";
import { AccessToken } from "livekit-server-sdk";
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

  // =========================================================================
  // GESTION OPTIMISÉE DE LA PRÉSENCE (MEMBERS_UPDATE)
  // =========================================================================
  // Cette fonction formate la liste des membres pour le réseau.
  // CRITIQUE : Par défaut (`includeState: false`), elle NE renvoie PAS l'état (titre, pause)
  // pour éviter d'inonder le réseau avec des paquets géants à chaque micro-changement.
  // Le client gardera en cache son propre état local.
  const getUIMembers = (room: Room, includeState: boolean) => {
    return room.members.map((m) => {
      const state = m.state || {};
      const uiState: any = {};
      
      if (state.uiTitle !== undefined) uiState.uiTitle = state.uiTitle;
      if (state.uiSubtitle !== undefined) uiState.uiSubtitle = state.uiSubtitle;
      if (state.isAd !== undefined) uiState.isAd = state.isAd;

      const hasState = Object.keys(uiState).length > 0;

      return {
        ...m,
        state: includeState && hasState ? uiState : undefined,
      };
    });
  };

  /**
   * Diffuse les changements de présence et de structure du salon
   * (Arrivée, Départ, Changement de session)
   */
  const broadcastMembers = (room: Room, includeState = false) => {
    io.to(room.id).emit("MEMBERS_UPDATE", {
      members: getUIMembers(room, includeState),
    });
    monitor.logMessage({
      socketId: "server",
      roomId: room.id,
      direction: "OUT",
      event: "MEMBERS_UPDATE",
      data: {
        membersCount: room.members.length,
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
      myId: socket.id,
      sessionId: hostSessionId,
      members: getUIMembers(room, true),
    });
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
        myId: socket.id,
        sessionId: targetSessionId,
        ts: Date.now(),
        members: getUIMembers(room, true),
      });

      broadcastMembers(room);
      console.log(`[ROOM] User ${userName} (${socket.id}) joined room ${roomId} in lobby`);
    }
  );

  // =========================================================================
  // 2b. QUITTER LE SALON COMPLÈTEMENT
  // =========================================================================
  socket.on("LEAVE_ROOM", () => {
    const results = removeMember(socket.id, socket.rooms);
    for (const { room, roomDeleted } of results) {
      socket.leave(room.id);
      if (!roomDeleted) {
        broadcastMembers(room);
      }
      console.log(`[ROOM] User ${socket.id} left room ${room.id}`);
    }
  });

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
        activePluginId: session.activePluginId,
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
          activePluginId: targetSession.activePluginId,
        },
      });
    });

    broadcastMembers(room);
  });

  // =========================================================================
  // 6. TRANSMISSION D'ACTIONS DANS UNE SESSION (Play, Pause, Seek, Video)
  // =========================================================================
  // C'est l'autoroute principale de l'application. Dès qu'un client bouge sa vidéo,
  // il envoie "SEND_ACTION". Le serveur :
  // 1. Vérifie la session et met à jour l'état serveur.
  // 2. Gère les "réactions collectives" (ex: "si je vois une pub, mets en pause les copains").
  // 3. Diffuse le "SYNC_ORDER" aux autres membres pour qu'ils s'alignent.
  socket.on("SEND_ACTION", (packet: SendActionPacket) => {
    const room = getRoom();
    if (!room || !packet.data) return;

    const member = room.members.find((m) => m.id === socket.id);
    if (!member) return;

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

        broadcastMembers(room);
      } else if (packet.data.activeUrl && navResult.newSessionId !== navResult.oldSessionId) {
        // The user navigated naturally to an EXISTING session!
        // We must NOT overwrite the existing session's state with their dummy payload!
        // Instead, we pull the existing session's state and send it to them.
        socket.emit("SESSION_CHANGED", { sessionId: navResult.newSessionId });
        
        const existingSession = room.sessions[navResult.newSessionId];
        const { state, ts } = extrapolateSession(existingSession);
        
        // On met à jour l'état du membre localement
        member.state = { ...existingSession.state };
        member.activeUrl = existingSession.activeUrl;
        
        socket.emit("SYNC_ORDER", {
          sessionId: navResult.newSessionId,
          ts,
          data: {
            ...state,
            activeUrl: existingSession.activeUrl,
            activePluginId: existingSession.activePluginId,
          },
        });
        
        broadcastMembers(room, true);
        return; // Fin du traitement: on n'applique pas leur action!
      }
    }

    const sessionId = member.sessionId;
    const session = room.sessions[sessionId];
    if (!session) return;

    // Application du moteur de réactions (pubs collectives, etc.)
    const enhancedData = processReactions(
      packet.data,
      session.state,
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

    // Vérifier si le serveur a modifié la requête (via processReactions)
    let isEcho = true;
    if (enhancedData.state && packet.data.state) {
      for (const key in enhancedData.state) {
        if (enhancedData.state[key] !== packet.data.state[key]) {
          isEcho = false;
          break;
        }
      }
    } else if (enhancedData.state !== packet.data.state) {
      isEcho = false;
    }

    // Si c'est un pur écho (aucune règle n'a altéré la commande),
    // on ne la renvoie pas à l'émetteur pour éviter qu'il ne se verrouille sur sa propre action.
    // S'il a été altéré (ex: on a forcé paused: true), on le renvoie à tout le monde.
    const target = isEcho ? socket.to(room.id) : io.to(room.id);
    
    target.emit("SYNC_ORDER", {
      sessionId,
      senderId: member.id,
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

    monitor.broadcastSnapshot(getAllRooms());
  });

  // =========================================================================
  // 6b. LIVEKIT TOKEN GENERATION
  // =========================================================================
  socket.on("GET_LIVEKIT_TOKEN", async (callback: (token?: string) => void) => {
    const room = getRoom();
    const member = room?.members.find((m) => m.id === socket.id);
    if (!room || !member) {
      if (callback) callback();
      return;
    }

    try {
      const apiKey = process.env.LIVEKIT_API_KEY || "dev_api_key";
      const apiSecret = process.env.LIVEKIT_API_SECRET || "dev_api_secret";

      const at = new AccessToken(apiKey, apiSecret, {
        identity: member.id,
        name: member.name,
      });

      at.addGrant({
        roomJoin: true,
        room: room.id,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();
      if (callback) callback(token);
    } catch (e) {
      console.error("[LIVEKIT] Error generating token", e);
      if (callback) callback();
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
