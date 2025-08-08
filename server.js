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
const db = new Low(adapter, { users: {}, rooms: {}, adminPasswordHash: '' });

async function initializeDatabase() {
    await db.read();
    db.data = db.data || { users: {}, rooms: {}, adminPasswordHash: '' };
    if (!db.data.adminPasswordHash) {
        const salt = await bcrypt.genSalt(10);
        db.data.adminPasswordHash = await bcrypt.hash('Austin', salt);
        await db.write();
    }
}
initializeDatabase();

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static('public'));

const activeRooms = {};

// --- Routes with Robust Error Handling ---
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// User Auth Routes
app.post('/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: "Username and password are required." });
        await db.read();
        if (db.data.users[username]) return res.status(409).json({ message: "User already exists." });
        const salt = await bcrypt.genSalt(10);
        db.data.users[username] = { passwordHash: await bcrypt.hash(password, salt), disabled: false };
        await db.write();
        res.status(201).json({ message: "User created successfully." });
    } catch (error) {
        res.status(500).json({ message: "Server error during signup." });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        await db.read();
        const user = db.data.users[username];
        if (!user) return res.status(404).json({ message: "User not found." });
        if (user.disabled) return res.status(403).json({ message: "This account has been disabled." });
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });
        res.status(200).json({ message: "Login successful." });
    } catch (error) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// New Route to get user's rooms
app.get('/my-rooms/:username', async (req, res) => {
    try {
        const { username } = req.params;
        await db.read();
        const userRooms = Object.keys(db.data.rooms).filter(roomCode => {
            const room = db.data.rooms[roomCode];
            // A user is part of a room if they are the owner or have sent a message
            return room.owner === username || room.messages.some(m => m.username === username);
        });
        res.status(200).json(userRooms);
    } catch (error) {
        res.status(500).json({ message: "Server error fetching user rooms." });
    }
});

// Admin Routes
app.get('/admin/data', async (req, res) => {
    try {
        await db.read();
        res.status(200).json({
            rooms: db.data.rooms || {},
            users: db.data.users || {}
        });
    } catch (error) {
        res.status(500).json({ message: "Failed to retrieve admin data." });
    }
});

// All other routes (create-room, login-room, other admin routes)
// should also have try...catch blocks for robustness, but are omitted here for brevity.
// ...

// Socket.IO logic remains the same
// ...

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
