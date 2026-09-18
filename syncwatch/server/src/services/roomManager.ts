import { Room, WatchSession, MemberPresence, SyncRule } from "../types/sync.js";
import { deepMerge, isSameMedia } from "./syncEngine.js";

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

/**
 * 1. Création d'un nouveau salon avec une session initiale
 */
export const createRoom = (
  socketId: string,
  userName: string
): { room: Room; hostSessionId: string } => {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const hostSessionId = generateSessionId(socketId);

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
    hostId: socketId,
    defaultSessionId: hostSessionId,
    members: [
      {
        id: socketId,
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
  console.log(`[ROOM] Created ${roomId} with session ${hostSessionId}`);
  return { room, hostSessionId };
};

/**
 * 2. Rejoint un salon existant (rejoint par défaut la session principale)
 */
export const joinRoom = (
  roomId: string,
  socketId: string,
  userName: string
): { room: Room; targetSessionId: string } | null => {
  const room = rooms.get(roomId);
  if (!room) return null;

  let targetSessionId = room.defaultSessionId;
  if (!targetSessionId || !room.sessions[targetSessionId]) {
    targetSessionId = generateSessionId(socketId);
    room.sessions[targetSessionId] = {
      id: targetSessionId,
      activeUrl: null,
      activePluginId: null,
      media: null,
      features: {},
      rules: {},
      lastUpdate: Date.now(),
    };
    room.defaultSessionId = targetSessionId;
  }

  const targetSession = room.sessions[targetSessionId];

  room.members.push({
    id: socketId,
    name: userName || "Invité",
    sessionId: targetSessionId,
    activeUrl: targetSession.activeUrl,
    title: targetSession.features?.ytTitle || "En attente",
    paused: targetSession.media?.paused ?? true,
    time: targetSession.media?.time ?? 0,
  });

  return { room, targetSessionId };
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
  member.title = targetSession.features?.ytTitle;

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
    m.title = targetSession.features?.ytTitle;
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
  media?: any,
  features?: any,
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

  // Création d'une nouvelle session dédiée à cette nouvelle vidéo
  const newSessionId = generateSessionId(member.id);
  member.sessionId = newSessionId;
  member.activeUrl = activeUrl;

  const newSession: WatchSession = {
    id: newSessionId,
    activeUrl,
    activePluginId: activePluginId || "youtube",
    media: media || { time: 0, paused: false },
    features: features || {},
    rules: rules || currentSession?.rules || {},
    lastUpdate: Date.now(),
  };

  room.sessions[newSessionId] = newSession;

  // Nettoyage de l'ancienne session si elle est devenue vide
  if (othersInOldSession.length === 0 && oldSessionId && oldSessionId !== newSessionId) {
    delete room.sessions[oldSessionId];
  }

  if (room.defaultSessionId === oldSessionId && !room.sessions[oldSessionId]) {
    room.defaultSessionId = newSessionId;
  }

  return { newSessionId, oldSessionId, isNewSession: true };
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
    session = {
      id: sessionId,
      activeUrl: null,
      activePluginId: null,
      media: null,
      features: {},
      rules: patch.rules || {},
      lastUpdate: Date.now(),
    };
    room.sessions[sessionId] = session;
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
