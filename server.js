// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

// --- Database Setup ---
const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, { users: {}, mainChat: {} });

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static('public'));

const MAIN_CHAT_CODE = "HMS";
const activeUsers = {}; // { socketId: { username, role } }
const pendingUsers = {}; // { socketId: username }

// --- Initial Server Setup ---
async function initializeServer() {
    try {
        await db.read();
        db.data = db.data || { users: {}, mainChat: {} };
        
        // Ensure the main chat room exists
        if (!db.data.mainChat.messages) {
            db.data.mainChat = {
                messages: [],
                settings: { approvalRequired: false },
                roles: {}
            };
        }

        // Ensure the owner account exists
        const ownerUsername = "Austin ;)";
        if (!db.data.users[ownerUsername]) {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash("AME", salt);
            db.data.users[ownerUsername] = { passwordHash };
            db.data.mainChat.roles[ownerUsername] = 'Owner';
        }
        
        await db.write();
        server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
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
        const user = db.data.users[username];

        if (user) { // Login existing user
            const isMatch = await bcrypt.compare(password, user.passwordHash);
            if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });
        } else { // Create new user
            const salt = await bcrypt.genSalt(10);
            db.data.users[username] = { passwordHash: await bcrypt.hash(password, salt) };
            db.data.mainChat.roles[username] = 'Member'; // Auto-assign member role
            await db.write();
        }
        
        const role = db.data.mainChat.roles[username] || 'Member';
        res.status(200).json({ message: "Login successful.", username, role });

    } catch (error) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('user-connect', async ({ username, role }) => {
        try {
            await db.read();
            const settings = db.data.mainChat.settings;
            activeUsers[socket.id] = { username, role };

            if (role === 'Owner' || role === 'Moderator' || !settings.approvalRequired) {
                socket.join(MAIN_CHAT_CODE);
                socket.emit('join-successful', { messages: db.data.mainChat.messages, settings });
                io.to(MAIN_CHAT_CODE).emit('user-list-update', getUsersWithRoles());
            } else {
                pendingUsers[socket.id] = username;
                socket.emit('waiting-for-approval');
                // Notify admins/mods
                getAdminSockets().forEach(adminSocket => {
                    adminSocket.emit('user-waiting-approval', getPendingUsers());
                });
            }
        } catch (error) {
            socket.emit('error', 'Server error on connection.');
        }
    });
    
    // ... Add other socket handlers for chat, moderation, etc.
    
    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
        delete pendingUsers[socket.id];
        io.to(MAIN_CHAT_CODE).emit('user-list-update', getUsersWithRoles());
        getAdminSockets().forEach(adminSocket => {
            adminSocket.emit('user-waiting-approval', getPendingUsers());
        });
    });
});

// --- Helper Functions ---
function getUsersWithRoles() {
    const userRoles = {};
    Object.values(activeUsers).forEach(user => {
        userRoles[user.username] = user.role;
    });
    return userRoles;
}

function getPendingUsers() {
    return Object.entries(pendingUsers).map(([socketId, username]) => ({ socketId, username }));
}

function getAdminSockets() {
    return Object.entries(activeUsers)
        .filter(([_, user]) => user.role === 'Owner' || user.role === 'Moderator')
        .map(([socketId, _]) => io.sockets.sockets.get(socketId))
        .filter(Boolean);
}

initializeServer();
