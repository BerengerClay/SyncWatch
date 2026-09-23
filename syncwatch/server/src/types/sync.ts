/**
 * SyncWatch - Définition stricte des types de synchronisation et de présence.
 */

export type SyncRuleType = "CONTINUOUS" | "DISCRETE" | "IGNORED";

export interface SyncRule {
  type: SyncRuleType;
  driftThreshold?: number;
  speedKey?: string;
  activeIfKey?: string;
  activeInverted?: boolean;
  blockingIfKey?: string;
  collective?: boolean;
  controllable?: boolean;
  reactions?: Record<string, Record<string, any>>;
}

export interface MemberPresence {
  id: string;
  name: string;
  sessionId: string;
  activeUrl?: string | null;
  state?: Record<string, any>;
}

export interface WatchSession {
  id: string;
  activeUrl: string | null;
  activePluginId: string | null;
  state: Record<string, any>;
  lastUpdate: number;
  rules?: Record<string, SyncRule>;
}

export interface Room {
  id: string;
  hostId: string;
  defaultSessionId: string;
  members: MemberPresence[];
  sessions: Record<string, WatchSession>;
}

export interface SendActionPacket {
  sessionId?: string;
  ts?: number;
  data: {
    activeUrl?: string;
    activePluginId?: string;
    state?: Record<string, any>;
    rules?: Record<string, SyncRule>;
    [key: string]: any;
  };
}
