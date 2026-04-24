import { Server, Socket } from "socket.io";

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

interface Member {
  id: string;
  name: string;
  lastMedia?: any;
  lastHeartbeatTs?: number;
}

interface Room {
  id: string;
  hostId: string;
  members: Member[];
  state: any;
  lastUpdate: number;
}

const rooms: Map<string, Room> = new Map();

export const setupRoomHandlers = (io: Server, socket: Socket) => {
  const getRoom = () => {
    const roomId = Array.from(socket.rooms).find((r) => r !== socket.id);
    return roomId ? rooms.get(roomId) : null;
  };

  const broadcastMembers = (room: Room) => {
    io.to(room.id).emit("MEMBERS_UPDATE", { members: room.members });
  };

  socket.on("CREATE_ROOM", ({ userName }: { userName: string }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room: Room = {
      id: roomId,
      hostId: socket.id,
      members: [{ id: socket.id, name: userName || "Host" }],
      state: {
        activeUrl: null,
        activePluginId: null,
        media: null,
        features: null,
        rules: {},
      },
      lastUpdate: Date.now(),
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit("ROOM_CREATED", {
      roomId,
      hostId: socket.id,
      members: room.members,
    });
    broadcastMembers(room);
  });

  socket.on(
    "JOIN_ROOM",
    ({ roomId, userName }: { roomId: string; userName: string }) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("ERROR", "Room not found");

      room.members.push({ id: socket.id, name: userName });
      socket.join(roomId);

      const now = Date.now();
      const timeDiff = (now - room.lastUpdate) / 1000;
      const initialState = JSON.parse(JSON.stringify(room.state));

      const rules = room.state.rules || {};
      Object.keys(rules).forEach((path) => {
        const rule = rules[path];
        if (rule.type === "CONTINUOUS") {
          const speed = rule.speedKey ? getValue(room.state, rule.speedKey) || 1 : 1;
          const active = rule.activeIfKey ? getValue(room.state, rule.activeIfKey) : true;
          if (rule.activeInverted ? !active : active) {
            const baseValue = getValue(room.state, path);
            if (typeof baseValue === "number") {
              const extrapolated = baseValue + timeDiff * speed;
              setValue(initialState, path, extrapolated);
            }
          }
        }
      });

      socket.emit("JOIN_SUCCESS", {
        roomId,
        hostId: room.hostId,
        ts: now,
        initialState,
        members: room.members,
      });

      broadcastMembers(room);
    }
  );

  socket.on("SEND_ACTION", (packet: { ts: number; data: any }) => {
    const room = getRoom();
    if (!room || !packet.data) return;

    const isHost = socket.id === room.hostId;

    if (!isHost && packet.data.rules) {
      delete packet.data.rules;
    }

    room.state = deepMerge(room.state, packet.data);
    room.lastUpdate = Date.now();

    socket.to(room.id).emit("SYNC_ORDER", { ts: packet.ts, data: packet.data });

    console.log(`[SYNC] Action relayed for room ${room.id} from ${socket.id}`);
  });

  socket.on("SEND_HEARTBEAT", (packet: { ts: number; data: any }) => {
    const room = getRoom();
    if (!room || !packet.data) return;

    const member = room.members.find((m) => m.id === socket.id);
    if (member && packet.data.media) {
      member.lastMedia = packet.data.media;
      member.lastHeartbeatTs = Date.now();
    }

    if (socket.id === room.hostId && packet.data.media) {
      room.state.media = deepMerge(room.state.media || {}, packet.data.media);
      room.lastUpdate = Date.now();
    }

    const now = Date.now();
    let minTime = Infinity;
    let maxTime = -Infinity;

    const telemetryReport = room.members.map((m) => {
      let estimatedTime = null;

      if (m.lastMedia && m.lastMedia.time !== undefined && m.lastHeartbeatTs) {
        const timeSinceLastHb = (now - m.lastHeartbeatTs) / 1000;
        const speed = m.lastMedia.playbackRate || 1;
        const isPlaying = !m.lastMedia.paused;
        estimatedTime = m.lastMedia.time + (isPlaying ? timeSinceLastHb * speed : 0);

        if (estimatedTime < minTime) minTime = estimatedTime;
        if (estimatedTime > maxTime) maxTime = estimatedTime;
      }

      return {
        id: m.id,
        name: m.name,
        time: estimatedTime,
        paused: m.lastMedia?.paused,
        isHost: m.id === room.hostId,
      };
    });

    if (minTime !== Infinity && maxTime !== -Infinity) {
      const spread = maxTime - minTime;
      const threshold = room.state.rules?.["media.time"]?.driftThreshold || 2.0;

      if (spread > threshold) {
        io.to(room.id).emit("ROOM_TELEMETRY", {
          alert: true,
          spread: parseFloat(spread.toFixed(2)),
          members: telemetryReport,
        });
      }
    }
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        const room = rooms.get(roomId);
        if (room) {
          room.members = room.members.filter((m) => m.id !== socket.id);
          if (room.members.length === 0) {
            rooms.delete(roomId);
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
