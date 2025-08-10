// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const cron = require('node-cron');

// --- Database Setup ---
const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, { users: {}, chatData: {} });

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const MAIN_CHAT_CODE = "HMS";
const activeUsers = {}; // { socketId: { username, role } }
const inappropriateWords = ['shit', 'fuck', 'damn', 'hell', 'cock', 'dick', 'gay']; // Add more words as needed

// --- Initial Server Setup ---
async function initializeServer() {
    try {
        await db.read();
        db.data = db.data || { users: {}, chatData: {} };
        
        if (!db.data.chatData.channels) {
            db.data.chatData = {
                channels: { 'general': { messages: [] } },
                dms: {},
                settings: { approvalRequired: false, giphyEnabled: true, backgroundUrl: '', botIcon: 'default' },
                roles: {},
                mutes: {},
                bans: []
            };
        }

        const ownerUsername = "Austin ;)";
        if (!db.data.users[ownerUsername]) {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash("AME", salt);
            db.data.users[ownerUsername] = { passwordHash, icon: 'default' };
            db.data.chatData.roles[ownerUsername] = 'Owner';
        }
        
        await db.write();
        
        cron.schedule('0 * * * *', async () => {
            // Auto-deletion logic
        });

        // CRITICAL FIX: Bind to host 0.0.0.0 as required by Render
        server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("FATAL: Could not start server.", error);
        process.exit(1);
    }
}

// --- Routes ---
// ... (Join and Login routes from previous version)

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    // ... (user-connect and disconnect logic)

    socket.on('chat-message', async (data) => {
        // ... (chat-message logic with spam detection and bad word filter)
    });

    socket.on('bot-command', (data) => {
        // ... (logic to handle bot commands like /8ball, /guess, etc.)
    });
    
    socket.on('force-redirect', () => {
        const user = activeUsers[socket.id];
        if (user && (user.role === 'Owner' || user.role === 'Co-Owner')) {
            io.emit('redirect-all', 'https://classroom.google.com');
        }
    });

    // ... (other handlers for moderation, settings, etc.)
});

initializeServer();
