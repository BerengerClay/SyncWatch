export interface MediaState {
  time?: number;
  paused?: boolean;
  duration?: number;
  playbackRate?: number;
  seeking?: boolean;
  [key: string]: any;
}

export interface FeaturesState {
  isAd?: boolean;
  title?: string;
  name?: string;
  [key: string]: any;
}

export interface MemberInfo {
  id: string;
  name: string;
  sessionId: string;
  activeUrl?: string | null;
  features?: FeaturesState;
  time?: number;
  paused?: boolean;
}

export interface WatchSessionState {
  id: string;
  activeUrl: string | null;
  activePluginId: string | null;
  media: MediaState | null;
  features: FeaturesState;
  lastUpdate: number;
}
