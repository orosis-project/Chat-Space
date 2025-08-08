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
    try {
        await db.read();
        db.data = db.data || { users: {}, rooms: {}, adminPasswordHash: '' };
        if (!db.data.adminPasswordHash) {
            const salt = await bcrypt.genSalt(10);
            db.data.adminPasswordHash = await bcrypt.hash('Austin', salt);
        }
        await db.write();
    } catch (error) {
        console.error("FATAL: Could not initialize database.", error);
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

app.post('/create-room', async (req, res) => {
    try {
        const { roomCode, username, password } = req.body;
        if (!roomCode || !username || !password) return res.status(400).json({ message: "All fields are required." });
        await db.read();
        if (db.data.rooms[roomCode]) return res.status(409).json({ message: "Room code already exists." });
        const salt = await bcrypt.genSalt(10);
        db.data.rooms[roomCode] = { owner: username, passwordHash: await bcrypt.hash(password, salt), bannedUsers: [], messages: [] };
        await db.write();
        activeRooms[roomCode] = { users: {} };
        res.status(201).json({ message: "Room created successfully." });
    } catch (error) {
        res.status(500).json({ message: "Server error creating room." });
    }
});

app.post('/login-room', async (req, res) => {
    try {
        const { roomCode, username, password } = req.body;
        await db.read();
        const room = db.data.rooms[roomCode];
        if (!room) return res.status(404).json({ message: "Room not found." });
        if (room.bannedUsers.includes(username)) return res.status(403).json({ message: "You are banned from this room." });
        const isMatch = await bcrypt.compare(password, room.passwordHash);
        if (!isMatch) return res.status(401).json({ message: "Invalid password." });
        if (!activeRooms[roomCode]) activeRooms[roomCode] = { users: {} };
        res.status(200).json({ message: "Login successful.", isOwner: room.owner === username });
    } catch (error) {
        res.status(500).json({ message: "Server error joining room." });
    }
});

app.get('/my-rooms/:username', async (req, res) => {
    try {
        const { username } = req.params;
        await db.read();
        const userRooms = Object.keys(db.data.rooms).filter(roomCode => {
            const room = db.data.rooms[roomCode];
            return room.owner === username || (room.messages && room.messages.some(m => m.username === username));
        });
        res.status(200).json(userRooms);
    } catch (error) {
        res.status(500).json({ message: "Server error fetching user rooms." });
    }
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('join-request', async ({ roomCode, username }) => {
        try {
            socket.join(roomCode);
            if (!activeRooms[roomCode]) activeRooms[roomCode] = { users: {} };
            activeRooms[roomCode].users[socket.id] = username;
            
            await db.read();
            const roomData = db.data.rooms[roomCode];
            
            socket.emit('join-successful', {
                previousMessages: roomData.messages || [],
                isOwner: roomData.owner === username
            });
            
            const userList = Object.values(activeRooms[roomCode].users);
            io.to(roomCode).emit('user-list-update', userList);
        } catch (error) {
            socket.emit('error', 'Failed to join room on server.');
        }
    });

    socket.on('chat-message', async (data) => {
        try {
            const { roomCode, message } = data;
            const room = activeRooms[roomCode];
            if (room && room.users[socket.id]) {
                const username = room.users[socket.id];
                const messageData = {
                    id: uuidv4(),
                    username,
                    message,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };
                await db.read();
                db.data.rooms[roomCode].messages.push(messageData);
                await db.write();
                io.to(roomCode).emit('chat-message', messageData);
            }
        } catch(error) {
            console.error("Chat message error:", error);
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in activeRooms) {
            if (activeRooms[roomCode].users[socket.id]) {
                const username = activeRooms[roomCode].users[socket.id];
                delete activeRooms[roomCode].users[socket.id];
                const userList = Object.values(activeRooms[roomCode].users);
                io.to(roomCode).emit('user-list-update', userList);
                break;
            }
        }
    });
});

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
