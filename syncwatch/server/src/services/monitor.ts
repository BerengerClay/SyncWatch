import { Server, Namespace } from "socket.io";

export interface SocketLogEntry {
  id: string;
  timestamp: number;
  socketId: string;
  userName?: string;
  roomId?: string;
  direction: "IN" | "OUT";
  event: string;
  data: any;
}

export interface MediaChangeEvent {
  id: string;
  timestamp: number;
  memberId: string;
  userName: string;
  roomId: string;
  sessionId: string;
  previousUrl?: string | null;
  newUrl: string | null;
  features?: Record<string, any>;
  time?: number;
  paused?: boolean;
}

export interface ServerStats {
  uptimeSeconds: number;
  memoryMb: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  totalConnections: number;
  activeRoomsCount: number;
  totalMembersCount: number;
  totalSessionsCount: number;
  totalMessagesCount: number;
}

class MonitorService {
  private io: Server | null = null;
  private adminNamespace: Namespace | null = null;
  private logs: SocketLogEntry[] = [];
  private mediaChanges: MediaChangeEvent[] = [];
  private totalMessagesCount = 0;
  private startTime = Date.now();
  private maxLogs = 300;
  private maxMediaChanges = 50;

  public init(io: Server) {
    this.io = io;
    this.adminNamespace = io.of("/admin");
  }

  public logMessage(entry: Omit<SocketLogEntry, "id" | "timestamp">) {
    this.totalMessagesCount++;
    const fullEntry: SocketLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      ...entry,
    };

    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // Émission STRICTEMENT réservée aux dashboards connectés sur /admin
    if (this.adminNamespace) {
      this.adminNamespace.emit("ADMIN_LOG", fullEntry);
    }
  }

  public recordMediaChange(change: Omit<MediaChangeEvent, "id" | "timestamp">) {
    const fullChange: MediaChangeEvent = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      ...change,
    };

    this.mediaChanges.unshift(fullChange);
    if (this.mediaChanges.length > this.maxMediaChanges) {
      this.mediaChanges.pop();
    }

    // Émission STRICTEMENT réservée aux dashboards connectés sur /admin
    if (this.adminNamespace) {
      this.adminNamespace.emit("ADMIN_MEDIA_CHANGED", fullChange);
    }
  }

  public getStats(activeRooms: any[] = []): ServerStats {
    const memory = process.memoryUsage();
    let totalMembers = 0;
    let totalSessions = 0;

    activeRooms.forEach((r) => {
      totalMembers += r.members?.length || 0;
      totalSessions += Object.keys(r.sessions || {}).length;
    });

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memoryMb: {
        heapUsed: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotal: Math.round((memory.heapTotal / 1024 / 1024) * 10) / 10,
        rss: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
      },
      totalConnections: this.io ? this.io.engine.clientsCount : 0,
      activeRoomsCount: activeRooms.length,
      totalMembersCount: totalMembers,
      totalSessionsCount: totalSessions,
      totalMessagesCount: this.totalMessagesCount,
    };
  }

  public getSnapshot(rooms: any[]) {
    return {
      stats: this.getStats(rooms),
      rooms,
      recentLogs: this.logs.slice(0, 50),
      recentMediaChanges: this.mediaChanges.slice(0, 20),
    };
  }

  public broadcastSnapshot(rooms: any[]) {
    if (this.adminNamespace) {
      this.adminNamespace.emit("ADMIN_SNAPSHOT", this.getSnapshot(rooms));
    }
  }
}

export const monitor = new MonitorService();
