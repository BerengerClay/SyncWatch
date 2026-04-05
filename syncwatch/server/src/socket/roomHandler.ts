import { Server, Socket } from 'socket.io';

interface Room {
    id: string;
    hostId: string;
    members: string[];
}

// Stockage en mémoire (volatile)
const rooms: Map<string, Room> = new Map();

export const setupRoomHandlers = (io: Server, socket: Socket) => {
    
    const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

    // Créer une room
    socket.on('CREATE_ROOM', () => {
        const roomId = generateRoomId();
        const room: Room = {
            id: roomId,
            hostId: socket.id,
            members: [socket.id]
        };
        
        rooms.set(roomId, room);
        socket.join(roomId);
        
        socket.emit('ROOM_CREATED', { roomId, hostId: socket.id });
        console.log(`[ROOM] Created: ${roomId} by ${socket.id}`);
    });

    // Rejoindre une room
    socket.on('JOIN_ROOM', (roomId: string) => {
        const room = rooms.get(roomId);
        
        if (room) {
            room.members.push(socket.id);
            socket.join(roomId);
            
            socket.to(roomId).emit('USER_JOINED', { userId: socket.id });
            socket.emit('JOIN_SUCCESS', { roomId, hostId: room.hostId });
            console.log(`[ROOM] ${socket.id} joined ${roomId}`);
        } else {
            socket.emit('ERROR', 'Room not found');
        }
    });

    // --- Synchronisation Agnostique (State Streaming) ---
    socket.on('BROADCAST_STATE', (fullState: any) => {
        const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
        if (roomId) {
            // Relay to everyone else in the room
            socket.to(roomId).emit('SYNC_STATE', fullState);
        }
    });

    // Déconnexion
    socket.on('disconnecting', () => {
        socket.rooms.forEach(roomId => {
            const room = rooms.get(roomId);
            if (room) {
                room.members = room.members.filter(id => id !== socket.id);
                
                if (room.members.length === 0) {
                    rooms.delete(roomId);
                } else if (room.hostId === socket.id) {
                    room.hostId = room.members[0];
                    io.to(roomId).emit('NEW_HOST', { hostId: room.hostId });
                }
                socket.to(roomId).emit('USER_LEFT', { userId: socket.id });
            }
        });
    });
};
