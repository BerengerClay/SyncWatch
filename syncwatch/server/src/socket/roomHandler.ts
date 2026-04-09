import { Server, Socket } from 'socket.io';

// --- HELPERS : Accès dynamique aux objets (ex: "media.time") ---
const getValue = (obj: any, path: string) => path.split('.').reduce((acc, part) => acc && acc[part], obj);
const setValue = (obj: any, path: string, value: any) => {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
};

// --- Dans roomHandler.ts ---

const deepMerge = (target: any, source: any) => {
    if (!source) return target;
    if (!target) target = {}; // Sécurité

    for (const key in source) {
        // 🛡️ CORRECTION : On vérifie que ce n'est PAS un tableau (Array.isArray)
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            target[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            // Pour les primitives (texte, nombres) et les Tableaux, on écrase directement
            target[key] = source[key];
        }
    }
    return target;
};

interface SyncRule {
    type: 'DISCRETE' | 'CONTINUOUS';
    driftThreshold?: number;
    speedKey?: string;     // ex: "media.playbackRate"
    activeIfKey?: string;  // ex: "media.paused"
    activeInverted?: boolean; // true si actif quand la clé est à false
}

interface Room {
    id: string;
    hostId: string;
    members: string[];
    state: any;
    rules: Record<string, SyncRule>;
    lastUpdate: number;
}

const rooms: Map<string, Room> = new Map();

export const setupRoomHandlers = (io: Server, socket: Socket) => {
    
    const getRoom = () => {
        const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
        return roomId ? rooms.get(roomId) : null;
    };

    socket.on('CREATE_ROOM', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const room: Room = { id: roomId, hostId: socket.id, members: [socket.id], state: {}, rules: {}, lastUpdate: Date.now() };
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('ROOM_CREATED', { roomId, hostId: socket.id });
    });

    socket.on('JOIN_ROOM', (roomId: string) => {
        const room = rooms.get(roomId);
        if (!room) return socket.emit('ERROR', 'Room not found');
        
        room.members.push(socket.id);
        socket.join(roomId);
        
        // --- Dans roomHandler.ts (Bloc JOIN_ROOM) ---

        // Calcul du "Late Joiner Catch-up"
        const now = Date.now();
        const timeDiff = (now - room.lastUpdate) / 1000;
        const initialState = JSON.parse(JSON.stringify(room.state));

        Object.keys(room.rules).forEach(path => {
            const rule = room.rules[path];
            if (rule.type === 'CONTINUOUS') {
                const speed = rule.speedKey ? (getValue(room.state, rule.speedKey) || 1) : 1;
                const active = rule.activeIfKey ? getValue(room.state, rule.activeIfKey) : true;
                
                if (rule.activeInverted ? !active : active) {
                    // 🛡️ CORRECTION : On s'assure qu'on a une base valide avant d'extrapoler
                    const baseValue = getValue(room.state, path);
                    if (typeof baseValue === 'number') {
                        const extrapolated = baseValue + (timeDiff * speed);
                        setValue(initialState, path, extrapolated);
                    }
                }
            }
        });

        socket.emit('JOIN_SUCCESS', { roomId, hostId: room.hostId, initialState });
        socket.to(roomId).emit('USER_JOINED', { userId: socket.id });
    });

    socket.on('SET_SYNC_RULES', (rules: Record<string, SyncRule>) => {
        const room = getRoom();
        if (room && socket.id === room.hostId) room.rules = rules;
    });

    // 📢 ACTION : Réception d'un Patch (Deep Diff)
    socket.on('SEND_ACTION', (packet: { ts: number, data: any }) => {
        const room = getRoom();
        if (!room || !packet.data) return;

        // On fusionne proprement le patch dans l'état global
        room.state = deepMerge(room.state, packet.data);
        room.lastUpdate = Date.now();
        
        // On diffuse l'état complet pour que tout le monde soit raccord
        socket.to(room.id).emit('SYNC_ORDER', room.state);
        console.log(`[SYNC] Action merged for room ${room.id}`);
    });

    // 💓 HEARTBEAT : Vérification de dérive
    socket.on('SEND_HEARTBEAT', (packet: { ts: number, data: any }) => {
        const room = getRoom();
        if (!room || !room.rules || !packet.data) return;

        const isHost = socket.id === room.hostId;
        const now = Date.now();
        const latency = packet.ts ? (now - packet.ts) / 1000 : 0;
        const timeSinceUpdate = (now - room.lastUpdate) / 1000;

        // 1. Le Host met à jour la référence (via merge aussi par sécurité)
        if (isHost) {
            room.state = deepMerge(room.state, packet.data);
            room.lastUpdate = now;
            return;
        }

        // 2. Les Guests sont arbitrés selon les règles
        let needsCorrection = false;
        const correction = JSON.parse(JSON.stringify(room.state));

        Object.keys(room.rules).forEach(path => {
            const rule = room.rules[path];
            const sVal = getValue(room.state, path);
            const cVal = getValue(packet.data, path);

            // On ne vérifie que si le client a envoyé la donnée dans son heartbeat
            if (cVal === undefined || cVal === null) return;

            if (rule.type === 'CONTINUOUS') {
                const speed = rule.speedKey ? (getValue(room.state, rule.speedKey) || 1) : 1;
                const active = rule.activeIfKey ? getValue(room.state, rule.activeIfKey) : true;
                const isActive = rule.activeInverted ? !active : active;

                const theoretical = sVal + (isActive ? timeSinceUpdate * speed : 0);
                const clientAdjusted = cVal + (isActive ? latency * speed : 0);
                
                if (Math.abs(theoretical - clientAdjusted) > (rule.driftThreshold || 2)) {
                    setValue(correction, path, theoretical);
                    needsCorrection = true;
                }
            } else if (rule.type === 'DISCRETE' && sVal !== cVal) {
                needsCorrection = true;
            }
        });

        if (needsCorrection) socket.emit('SYNC_ORDER', correction);
    });
};