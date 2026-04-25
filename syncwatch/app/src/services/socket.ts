import { io } from 'socket.io-client';

// Connecter directement au serveur Node.js sur le port 3001
export const socket = io('https://syncwatch-server.beclay.fr', {
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
        'SYNC_STATE', 'SYNC_ORDER', 'SET_ACTIVE_PLUGIN',
        'MEMBERS_UPDATE'
    ];

    // On stocke les wrappers pour pouvoir les retirer précisément
    const handlers: Record<string, (data: any) => void> = {};
    
    events.forEach(eventName => {
        const handler = (data: any) => {
            const payload = (typeof data === 'object' && data !== null) ? data : { value: data };
            callback({ type: eventName, ...payload });
        };
        handlers[eventName] = handler;
        socket.on(eventName, handler);
    });

    // Retourne une fonction de nettoyage ciblée
    return () => {
        Object.entries(handlers).forEach(([eventName, handler]) => {
            socket.off(eventName, handler);
        });
    };
};


socket.on('connect', () => {
    console.log('[SyncWatch] Connected to Socket.io server');
});

socket.on('connect_error', (error) => {
    console.error('[SyncWatch] Socket.io connection error:', error);
});
