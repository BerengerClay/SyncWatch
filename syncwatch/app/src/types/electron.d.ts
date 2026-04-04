interface ElectronBridge {
  send: (channel: string, data: any) => void;
  on: (channel: string, func: (...args: any[]) => void) => void;
  invoke: (channel: string, data: any) => Promise<any>;
  controlYouTube: (command: 'play' | 'pause' | 'seek', value?: any) => void;
}

declare global {
  interface Window {
    electron?: ElectronBridge; // Optional: not available outside Electron context
  }
}

export {};
