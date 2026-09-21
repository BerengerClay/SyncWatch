import React, { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MemberInfo } from '../types/sync';

interface UseWatchSessionProps {
  activeUrl: string | null;
  onJoinSession?: (sessionId: string) => void;
}

export function useWatchSession({ activeUrl, onJoinSession }: UseWatchSessionProps) {
  const [pluginState, setPluginState] = useState<Record<string, any> | null>(null);
  const [currentLocalUrl, setCurrentLocalUrl] = useState<string | null>(activeUrl);
  const [selectedMember, setSelectedMember] = useState<MemberInfo | null>(null);

  const [PluginUI, setPluginUI] = useState<React.FC<any> | null>(null);
  const lastCode = useRef<string | null>(null);

  const handleUpdate = useCallback((payload: any) => {
    const { state, sidebarCode, activeUrl: reportedUrl } = payload;

    if (reportedUrl) {
      setCurrentLocalUrl(reportedUrl);
    }

    if (state === null) {
      setPluginState(null);
    } else if (state) {
      setPluginState((prev) => {
        if (!prev) return state;
        return { ...prev, ...state };
      });
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

    if (command === 'APPLY_STATE' && data.state) {
      setPluginState((prev) => ({ ...(prev || {}), ...data.state }));
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
    pluginState,
    currentLocalUrl,
    selectedMember,
    setSelectedMember,
    PluginUI,
    handleUpdate,
    handleControl,
    handleJoinFriend
  };
}
