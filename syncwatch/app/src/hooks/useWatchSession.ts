import React, { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MediaState, FeaturesState, MemberInfo } from '../types/sync';

interface UseWatchSessionProps {
  activeUrl: string | null;
  onJoinSession?: (sessionId: string) => void;
}

export function useWatchSession({ activeUrl, onJoinSession }: UseWatchSessionProps) {
  const [mediaState, setMediaState] = useState<MediaState | null>(null);
  const [featuresState, setFeaturesState] = useState<FeaturesState | null>(null);
  const [currentLocalUrl, setCurrentLocalUrl] = useState<string | null>(activeUrl);
  const [selectedMember, setSelectedMember] = useState<MemberInfo | null>(null);

  const [PluginUI, setPluginUI] = useState<React.FC<any> | null>(null);
  const lastCode = useRef<string | null>(null);

  const handleUpdate = useCallback((payload: any) => {
    const { media, features, sidebarCode, activeUrl: reportedUrl } = payload;

    if (reportedUrl) {
      setCurrentLocalUrl(reportedUrl);
    }

    if (media === null) {
      setMediaState(null);
      setFeaturesState(null);
    } else if (media) {
      setMediaState((prev) => {
        if (!prev) return media;
        return { ...prev, ...media };
      });
    }

    if (media !== null && features && Object.keys(features).length > 0) {
      setFeaturesState((prev) => ({ ...prev, ...features }));
    }

    if (sidebarCode && sidebarCode !== lastCode.current) {
      try {
        const factory = new Function('React', `return ${sidebarCode}`);
        setPluginUI(() => factory(React));
        lastCode.current = sidebarCode;
      } catch (e) {
        console.error(`[SyncWatch] ⚠️ Échec de compilation :`, e);
      }
    }
  }, []);

  const handleControl = useCallback((command: string, data: any) => {
    invoke('playback_control', { command, data }).catch(console.error);

    if (command === 'APPLY_STATE' && data.media) {
      setMediaState((prev) => ({ ...prev, ...data.media }));
    }
  }, []);

  const handleJoinFriend = useCallback((member: MemberInfo) => {
    if (!member?.sessionId) return;
    console.log('[SyncWatch] 🎯 Rejoindre la session de :', member.name);

    if (onJoinSession) {
      onJoinSession(member.sessionId);
    }

    setSelectedMember(null);
  }, [onJoinSession]);

  return {
    mediaState,
    featuresState,
    currentLocalUrl,
    selectedMember,
    setSelectedMember,
    PluginUI,
    handleUpdate,
    handleControl,
    handleJoinFriend
  };
}
