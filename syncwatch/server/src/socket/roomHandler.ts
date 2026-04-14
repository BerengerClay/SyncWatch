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

interface Member {
    id: string;
    name: string;
}

interface Room {
    id: string;
    hostId: string;
    members: Member[];
    state: any;
    lastUpdate: number;
}



const rooms: Map<string, Room> = new Map();

export const setupRoomHandlers = (io: Server, socket: Socket) => {
    
    const getRoom = () => {
        const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
        return roomId ? rooms.get(roomId) : null;
    };

    const broadcastMembers = (room: Room) => {
        io.to(room.id).emit('MEMBERS_UPDATE', { members: room.members });
    };



    socket.on('CREATE_ROOM', ({ userName }: { userName: string }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const room: Room = { 
            id: roomId, 
            hostId: socket.id, 
            members: [{ id: socket.id, name: userName || 'Host' }], 
            state: {
                activeUrl: null,
                activePluginId: null,
                media: null,
                features: null,
                rules: {}
            }, 
            lastUpdate: Date.now()
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('ROOM_CREATED', { roomId, hostId: socket.id, members: room.members });
        broadcastMembers(room);
    });




    socket.on('JOIN_ROOM', ({ roomId, userName }: { roomId: string, userName: string }) => {
        const room = rooms.get(roomId);
        if (!room) {
            console.log(`[JOIN_ERROR] Room ${roomId} not found for user ${userName}`);
            return socket.emit('ERROR', 'Room not found');
        }
        
        room.members.push({ id: socket.id, name: userName });
        socket.join(roomId);
        
        // Calcul du "Late Joiner Catch-up"
        const now = Date.now();
        const timeDiff = (now - room.lastUpdate) / 1000;
        const initialState = JSON.parse(JSON.stringify(room.state));

        const rules = room.state.rules || {};
        Object.keys(rules).forEach(path => {
            const rule = rules[path];
            if (rule.type === 'CONTINUOUS') {
                const speed = rule.speedKey ? (getValue(room.state, rule.speedKey) || 1) : 1;
                const active = rule.activeIfKey ? getValue(room.state, rule.activeIfKey) : true;
                
                if (rule.activeInverted ? !active : active) {
                    const baseValue = getValue(room.state, path);
                    if (typeof baseValue === 'number') {
                        const extrapolated = baseValue + (timeDiff * speed);
                        setValue(initialState, path, extrapolated);
                    }
                }
            }
        });


        socket.emit('JOIN_SUCCESS', { 
            roomId, 
            hostId: room.hostId, 
            initialState,
            members: room.members
        });



        
        broadcastMembers(room);
    });





    // 📢 ACTION : Réception d'un Patch (Deep Diff)
    socket.on('SEND_ACTION', (packet: { ts: number, data: any }) => {
        const room = getRoom();
        if (!room || !packet.data) return;

        const isHost = socket.id === room.hostId;


        // 🛡️ SÉCURITÉ : Seul l'Host peut modifier les règles de synchronisation
        if (!isHost && packet.data.rules) {
            delete packet.data.rules;
        }

        // 1. Mise à jour de la mémoire interne (Deep Merge de tout le patch)
        room.state = deepMerge(room.state, packet.data);

        room.lastUpdate = Date.now();

        // 2. Diffusion du DELTA (Relais pur)
        socket.to(room.id).emit('SYNC_ORDER', packet.data);

        console.log(`[SYNC] Action relayed for room ${room.id} (URL: ${room.state.activeUrl || 'none'})`);




    });


    // 🧭 NAVIGATION : Ordre de changement de source (ex: cliquer sur YouTube sur la Remote)




    // 💓 HEARTBEAT : Vérification de dérive
    socket.on('SEND_HEARTBEAT', (packet: { ts: number, data: any }) => {
        const room = getRoom();
        if (!room || !packet.data) return;

        const rules = room.state.rules || {};
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

        Object.keys(rules).forEach(path => {
            const rule = rules[path];
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


    socket.on('disconnecting', () => {
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                const room = rooms.get(roomId);
                if (room) {
                    room.members = room.members.filter(m => m.id !== socket.id);
                    if (room.members.length === 0) {
                        rooms.delete(roomId);
                    } else {
                        // Si le host part, on peut nommer un nouveau host ou juste vider ?
                        // Pour l'instant on garde le hostId original ou on prend le suivant
                        if (room.hostId === socket.id) {
                            room.hostId = room.members[0].id;
                        }
                        broadcastMembers(room);
                    }
                }
            }
        }
    });
};