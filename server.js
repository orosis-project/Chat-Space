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
const inappropriateWords = ['example1', 'example2', 'example3']; // Add more words as needed

// --- Initial Server Setup ---
async function initializeServer() {
    try {
        await db.read();
        db.data = db.data || { users: {}, chatData: {} };
        
        if (!db.data.chatData.channels) {
            db.data.chatData = {
                channels: { 'general': { messages: [] } },
                dms: {},
                settings: { approvalRequired: false, giphyEnabled: true },
                roles: {},
                mutes: {},
                bans: []
            };
        }

        const ownerUsername = "Austin ;)";
        if (!db.data.users[ownerUsername]) {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash("AME", salt);
            db.data.users[ownerUsername] = { passwordHash };
            db.data.chatData.roles[ownerUsername] = 'Owner';
        }
        
        await db.write();
        
        // Schedule auto-deletion of messages every hour
        cron.schedule('0 * * * *', async () => {
            await db.read();
            const now = Date.now();
            for (const channel in db.data.chatData.channels) {
                db.data.chatData.channels[channel].messages = db.data.chatData.channels[channel].messages.filter(msg => {
                    return msg.pinned || (now - msg.timestamp < 24 * 60 * 60 * 1000);
                });
            }
            await db.write();
            io.emit('messages-purged');
        });

        server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("FATAL: Could not start server.", error);
        process.exit(1);
    }
}

// --- Routes ---
// ... (Join and Login routes from previous version)

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    // ... (user-connect and disconnect logic from previous version)

    socket.on('chat-message', async (data) => {
        // ... (chat-message logic with flagging and censoring)
    });

    socket.on('image-message', async (data) => {
        // ... (logic to handle image uploads)
    });

    socket.on('add-reaction', async (data) => {
        // ... (logic to add a reaction to a message)
    });

    socket.on('pin-message', async (data) => {
        // ... (logic for owners/co-owners to pin a message)
    });

    socket.on('promote-user', async (data) => {
        // ... (logic for owner to promote/demote users, protecting the original owner)
    });

    // ... (other moderation and settings handlers)
});

initializeServer();
