import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { setupRoomHandlers } from './socket/roomHandler.js'; // Notez le .js pour ESM

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Activation du CORS pour Tauri
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Autorise toutes les origines pour le dev
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.send({ status: 'ok', timestamp: new Date() });
});

io.on('connection', (socket) => {
    console.log(`[IO] New connection: ${socket.id}`);
    setupRoomHandlers(io, socket);
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
