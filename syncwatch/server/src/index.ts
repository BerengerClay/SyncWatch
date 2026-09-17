import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupRoomHandlers, getAllRooms } from './socket/roomHandler.js';
import { monitor } from './services/monitor.js';

import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Résolution robuste du dossier public (compatible dev tsx, prod node dist/index.js, et Docker)
let publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
    const cwdPublic = path.join(process.cwd(), 'public');
    if (fs.existsSync(path.join(cwdPublic, 'index.html'))) {
        publicDir = cwdPublic;
    }
}

const app = express();
const httpServer = createServer(app);

// Activation du CORS pour Tauri et l'interface Web
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialisation du service de monitoring
monitor.init(io);

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.get('/health', (req, res) => {
    res.send({ status: 'ok', timestamp: new Date() });
});

app.get('/api/snapshot', (req, res) => {
    res.json(monitor.getSnapshot(getAllRooms()));
});

app.get(['/', '/dashboard'], (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`Dashboard index.html not found. Checked path: ${indexPath}`);
    }
});

io.on('connection', (socket) => {
    console.log(`[IO] New connection: ${socket.id}`);

    // Gestion spéciale pour le Dashboard d'administration
    socket.on("ADMIN_GET_SNAPSHOT", () => {
        socket.emit("ADMIN_SNAPSHOT", monitor.getSnapshot(getAllRooms()));
    });

    // Envoi immédiat du snapshot au cas où c'est un client dashboard
    socket.emit("ADMIN_SNAPSHOT", monitor.getSnapshot(getAllRooms()));

    setupRoomHandlers(io, socket);
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Web Dashboard available at http://localhost:${PORT}`);
});

