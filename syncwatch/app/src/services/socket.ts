import { io } from 'socket.io-client';

// Connecter directement au serveur Node.js sur le port 3001
export const socket = io('http://127.0.0.1:3001', {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true
});

// Helper pour écouter les messages (ROOM_CREATED, JOIN_SUCCESS, etc.)
// Cette version utilise directement l'instance socket au lieu de passer par Rust
export const listenToServer = (callback: (data: any) => void) => {
    // Liste des événements que le serveur émet
    const events = [
        'ROOM_CREATED', 'JOIN_SUCCESS', 'CHAT_MSG', 'USER_JOINED', 'USER_LEFT',
        'SYNC_STATE', 'SYNC_ORDER'
    ];
    
    const handler = (event: string, data: any) => {
        callback({ type: event, ...data });
    };

    // Écouteur générique pour mapper les événements du serveur vers le format attendu par App.tsx
    events.forEach(eventName => {
        socket.on(eventName, (data) => handler(eventName, data));
    });

    // Retourne une fonction de nettoyage
    return () => {
        events.forEach(eventName => {
            socket.off(eventName);
        });
    };
};

socket.on('connect', () => {
    console.log('[SyncWatch] Connected to Socket.io server');
});

socket.on('connect_error', (error) => {
    console.error('[SyncWatch] Socket.io connection error:', error);
});
