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

// --- Routes ---
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// User Auth Routes
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    await db.read();
    if (db.data.users[username]) return res.status(409).json({ message: "User already exists." });
    const salt = await bcrypt.genSalt(10);
    db.data.users[username] = { passwordHash: await bcrypt.hash(password, salt), disabled: false };
    await db.write();
    res.status(201).json({ message: "User created successfully." });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    await db.read();
    const user = db.data.users[username];
    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.disabled) return res.status(403).json({ message: "This account has been disabled." });
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });
    res.status(200).json({ message: "Login successful." });
});

// Room Routes (No changes)
// ...

// Admin Routes
app.post('/admin-login', async (req, res) => {
    const { password } = req.body;
    await db.read();
    const isMatch = await bcrypt.compare(password, db.data.adminPasswordHash);
    if (!isMatch) return res.status(401).json({ message: "Invalid Admin Password." });
    res.status(200).json({ message: "Admin login successful." });
});

app.get('/admin/data', async (req, res) => {
    await db.read();
    res.status(200).json({ rooms: db.data.rooms, users: db.data.users });
});

app.delete('/admin/delete-room/:roomCode', async (req, res) => {
    const { roomCode } = req.params;
    await db.read();
    if (db.data.rooms[roomCode]) {
        delete db.data.rooms[roomCode];
        await db.write();
        if (activeRooms[roomCode]) {
            io.to(roomCode).emit('room-deleted');
            delete activeRooms[roomCode];
        }
        res.status(200).json({ message: `Room ${roomCode} deleted.` });
    } else {
        res.status(404).json({ message: "Room not found." });
    }
});

app.post('/admin/toggle-user-disable/:username', async (req, res) => {
    const { username } = req.params;
    await db.read();
    if (db.data.users[username]) {
        db.data.users[username].disabled = !db.data.users[username].disabled;
        await db.write();
        res.status(200).json({ message: `User ${username} status updated.` });
    } else {
        res.status(404).json({ message: "User not found." });
    }
});

app.delete('/admin/delete-user/:username', async (req, res) => {
    const { username } = req.params;
    await db.read();
    if (db.data.users[username]) {
        delete db.data.users[username];
        await db.write();
        res.status(200).json({ message: `User ${username} deleted.` });
    } else {
        res.status(404).json({ message: "User not found." });
    }
});


// --- Socket.IO Logic (No changes) ---
// ...

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
