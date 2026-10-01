import { Room, WatchSession, MemberPresence, SyncRule } from "../types/sync.js";
import { deepMerge, isSameMedia, extrapolateSession } from "./syncEngine.js";

/**
 * Gestionnaire d'état en mémoire des Salles (Rooms) et des Sessions (WatchSessions).
 */

const rooms: Map<string, Room> = new Map();

export const getAllRooms = (): Room[] => Array.from(rooms.values());

export const getRoomById = (roomId: string): Room | undefined => rooms.get(roomId);

export const getRoomBySocket = (
  socketId: string,
  socketRooms: Iterable<string>
): Room | null => {
  for (const rId of socketRooms) {
    if (rId !== socketId) {
      const room = rooms.get(rId);
      if (room) return room;
    }
  }
  return null;
};

const generateSessionId = (socketId: string): string =>
  `${socketId.substring(0, 6)}_${Date.now().toString(36)}`;

const createEmptySession = (id: string, rules?: Record<string, SyncRule>): WatchSession => ({
  id,
  activeUrl: null,
  activePluginId: null,
  state: {},
  rules: rules || {},
  lastUpdate: Date.now(),
});

/**
 * 1. Création d'un nouveau salon avec une session initiale
 */
export const createRoom = (
  socketId: string,
  userName: string
): { room: Room; hostSessionId: string } => {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const hostSessionId = generateSessionId(socketId);

  const initialSession = createEmptySession(hostSessionId);

  const room: Room = {
    id: roomId,
    hostId: socketId,
    defaultSessionId: hostSessionId,
    members: [
      {
        id: socketId,
        name: userName || "Host",
        sessionId: hostSessionId,
        activeUrl: null,
        state: {},
      },
    ],
    sessions: {
      [hostSessionId]: initialSession,
    },
  };

  rooms.set(roomId, room);
  console.log(`[ROOM] Created ${roomId} with session ${hostSessionId}`);
  return { room, hostSessionId };
};

/**
 * 2. Rejoint un salon existant (rejoint toujours le lobby avec sa propre session vierge)
 */
export const joinRoom = (
  roomId: string,
  socketId: string,
  userName: string
): { room: Room; targetSessionId: string } | null => {
  const room = rooms.get(roomId);
  if (!room) return null;

  // Chaque membre commence dans sa propre session vierge dans le lobby
  const userSessionId = generateSessionId(socketId);
  room.sessions[userSessionId] = createEmptySession(userSessionId);

  room.members.push({
    id: socketId,
    name: userName || "Invité",
    sessionId: userSessionId,
    activeUrl: null,
    state: {},
  });

  return { room, targetSessionId: userSessionId };
};

/**
 * Quitte une session de visionnage pour retourner dans le lobby
 */
export const leaveSessionToLobby = (
  room: Room,
  socketId: string
): { member: MemberPresence; newSessionId: string } | null => {
  const member = room.members.find((m) => m.id === socketId);
  if (!member) return null;

  const newSessionId = generateSessionId(socketId);
  member.sessionId = newSessionId;
  member.activeUrl = null;
  member.state = {};

  room.sessions[newSessionId] = createEmptySession(newSessionId);

  cleanupOrphanSessions(room);
  return { member, newSessionId };
};

/**
 * 3. Rejoint la session d'un autre membre ("Watch with")
 */
export const joinSession = (
  room: Room,
  socketId: string,
  targetSessionId: string
): { member: MemberPresence; session: WatchSession } | null => {
  const targetSession = room.sessions[targetSessionId];
  const member = room.members.find((m) => m.id === socketId);
  if (!targetSession || !member) return null;

  member.sessionId = targetSessionId;
  member.activeUrl = targetSession.activeUrl;
  member.state = { ...targetSession.state };

  return { member, session: targetSession };
};

/**
 * 4. Diffuse la session d'un membre à tous les autres membres du salon
 */
export const broadcastSessionToRoom = (
  room: Room,
  senderSocketId: string,
  requestedSessionId?: string
): { targetSession: WatchSession; otherMembers: MemberPresence[] } | null => {
  const member = room.members.find((m) => m.id === senderSocketId);
  if (!member) return null;

  const targetSessionId = requestedSessionId || member.sessionId;
  const targetSession = room.sessions[targetSessionId];
  if (!targetSession) return null;

  room.defaultSessionId = targetSessionId;
  const otherMembers = room.members.filter((m) => m.id !== senderSocketId);

  otherMembers.forEach((m) => {
    m.sessionId = targetSessionId;
    m.activeUrl = targetSession.activeUrl;
    m.state = { ...targetSession.state };
  });

  return { targetSession, otherMembers };
};

/**
 * 5. Gestion de la navigation / changement de vidéo par un utilisateur
 */
export const handleVideoNavigation = (
  room: Room,
  member: MemberPresence,
  activeUrl: string,
  activePluginId?: string,
  state?: Record<string, any>,
  rules?: Record<string, SyncRule>
): { newSessionId: string; oldSessionId: string; isNewSession: boolean } => {
  const currentSession = room.sessions[member.sessionId];
  const prevUrl = member.activeUrl || currentSession?.activeUrl;
  const isUrlChanged = !prevUrl || !isSameMedia(prevUrl, activeUrl);

  if (!isUrlChanged) {
    return {
      newSessionId: member.sessionId,
      oldSessionId: member.sessionId,
      isNewSession: false,
    };
  }

  const oldSessionId = member.sessionId;
  const othersInOldSession = room.members.filter(
    (m) => m.sessionId === oldSessionId && m.id !== member.id
  );

  // Recherche d'une session existante avec le même média
  const existingSessionId = Object.keys(room.sessions).find(
    (sId) => isSameMedia(room.sessions[sId].activeUrl, activeUrl)
  );

  let newSessionId: string;
  let isNewSession = false;

  if (existingSessionId && existingSessionId !== oldSessionId) {
    newSessionId = existingSessionId;
    member.sessionId = newSessionId;
    member.activeUrl = activeUrl;
    // On ne met pas à jour l'état du membre ici car il rejoint une session existante (géré par roomHandler)
  } else {
    // Création d'une nouvelle session dédiée à cette nouvelle vidéo
    newSessionId = generateSessionId(member.id);
    member.sessionId = newSessionId;
    member.activeUrl = activeUrl;
    if (state) member.state = { ...state };

    const newSession = createEmptySession(newSessionId, rules || currentSession?.rules);
    newSession.activeUrl = activeUrl;
    newSession.activePluginId = activePluginId || null;
    newSession.state = state || {};

    room.sessions[newSessionId] = newSession;
    isNewSession = true;
  }

  // Nettoyage de l'ancienne session si elle est devenue vide
  if (othersInOldSession.length === 0 && oldSessionId && oldSessionId !== newSessionId) {
    delete room.sessions[oldSessionId];
  }

  if (room.defaultSessionId === oldSessionId && !room.sessions[oldSessionId]) {
    room.defaultSessionId = newSessionId;
  }

  return { newSessionId, oldSessionId, isNewSession };
};

/**
 * 6. Mise à jour de l'état d'une session avec patch incrémental
 */
export const updateSessionState = (
  room: Room,
  sessionId: string,
  patch: any
): WatchSession => {
  let session = room.sessions[sessionId];
  if (!session) {
    session = createEmptySession(sessionId, patch.rules);
    room.sessions[sessionId] = session;
  } else {
    // ⚡ Extrapole l'état actuel de la session jusqu'à MAINTENANT
    // avant d'appliquer la nouvelle modification.
    session = extrapolateSession(session).state;
  }

  room.sessions[sessionId] = deepMerge(session, patch);
  room.sessions[sessionId].lastUpdate = Date.now();
  return room.sessions[sessionId];
};

/**
 * 7. Nettoyage des sessions orphelines (aucun membre présent)
 */
export const cleanupOrphanSessions = (room: Room): void => {
  Object.keys(room.sessions).forEach((sId) => {
    const hasMembers = room.members.some((m) => m.sessionId === sId);
    if (!hasMembers) {
      delete room.sessions[sId];
    }
  });

  if (!room.sessions[room.defaultSessionId] && room.members.length > 0) {
    room.defaultSessionId = room.members[0].sessionId;
  }
};

/**
 * 8. Gestion de la déconnexion d'un membre
 */
export const removeMember = (
  socketId: string,
  socketRooms: Iterable<string>
): { room: Room; roomDeleted: boolean }[] => {
  const results: { room: Room; roomDeleted: boolean }[] = [];

  for (const roomId of socketRooms) {
    if (roomId !== socketId) {
      const room = rooms.get(roomId);
      if (room) {
        room.members = room.members.filter((m) => m.id !== socketId);
        cleanupOrphanSessions(room);

        if (room.members.length === 0) {
          rooms.delete(roomId);
          console.log(`[ROOM] Room ${roomId} deleted (empty)`);
          results.push({ room, roomDeleted: true });
        } else {
          if (room.hostId === socketId) {
            room.hostId = room.members[0].id;
          }
          results.push({ room, roomDeleted: false });
        }
      }
    }
  }

  return results;
};
