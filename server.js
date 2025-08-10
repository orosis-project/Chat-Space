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
const messageTimestamps = {}; // { username: [timestamps] }
const cooldowns = {}; // { username: timeoutId }

const inappropriateWords = ['swear1', 'profanity2', 'badword3']; // Add more words as needed

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

        server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("FATAL: Could not start server.", error);
        process.exit(1);
    }
}

// --- Routes ---
app.post('/join', (req, res) => {
    if (req.body.code === MAIN_CHAT_CODE) {
        res.status(200).json({ message: "Access granted." });
    } else {
        res.status(401).json({ message: "Invalid Join Code." });
    }
});

app.post('/login', async (req, res) => {
    try {
        await db.read();
        const { username, password } = req.body;
        if (db.data.chatData.bans && db.data.chatData.bans.includes(username)) {
            return res.status(403).json({ message: "You are banned from this chat." });
        }
        const user = db.data.users[username];

        if (user) {
            const isMatch = await bcrypt.compare(password, user.passwordHash);
            if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });
        } else {
            const salt = await bcrypt.genSalt(10);
            db.data.users[username] = { passwordHash: await bcrypt.hash(password, salt) };
            db.data.chatData.roles[username] = 'Member';
            await db.write();
        }
        
        const role = db.data.chatData.roles[username] || 'Member';
        res.status(200).json({ message: "Login successful.", username, role });

    } catch (error) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    // ... Full socket logic for all features
});

initializeServer();
