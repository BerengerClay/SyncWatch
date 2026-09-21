export interface MemberInfo {
  id: string;
  name: string;
  sessionId: string;
  activeUrl?: string | null;
  state?: Record<string, any>;
}

export interface WatchSessionState {
  id: string;
  activeUrl: string | null;
  activePluginId: string | null;
  state: Record<string, any>;
  lastUpdate: number;
}
