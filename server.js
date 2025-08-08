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
// FIX: Provide a default value to the Low constructor to prevent crash
const db = new Low(adapter, { rooms: {} });

async function initializeDatabase() {
    await db.read();
    // Ensure data structure exists
    db.data = db.data || { rooms: {} };
    await db.write();
}
initializeDatabase();

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static('public'));

const activeRooms = {}; // { roomCode: { users: { socketId: username }, typing: [], pending: {} } }

// --- Routes ---
app.get('/chat', (req, res) => res.sendFile(__dirname + '/public/index.html'));

app.post('/create-room', async (req, res) => {
    const { roomCode, username, password } = req.body;
    if (!roomCode || !username || !password) return res.status(400).json({ message: "All fields are required." });

    await db.read();
    if (db.data.rooms[roomCode]) return res.status(409).json({ message: "Room code already exists." });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    db.data.rooms[roomCode] = { owner: username, passwordHash, mode: 'open', restrictedUsers: [], bannedUsers: [], messages: [] };
    await db.write();
    
    activeRooms[roomCode] = { users: {}, typing: [], pending: {} };
    res.status(201).json({ message: "Room created successfully." });
});

app.post('/login-room', async (req, res) => {
    const { roomCode, username, password } = req.body;
    await db.read();
    const room = db.data.rooms[roomCode];

    if (!room) return res.status(404).json({ message: "Room not found." });
    if (room.bannedUsers.includes(username)) return res.status(403).json({ message: "You are banned from this room." });

    const isMatch = await bcrypt.compare(password, room.passwordHash);
    if (!isMatch) return res.status(401).json({ message: "Invalid password." });
    
    if (!activeRooms[roomCode]) activeRooms[roomCode] = { users: {}, typing: [], pending: {} };

    res.status(200).json({ message: "Login successful.", isOwner: room.owner === username, roomMode: room.mode, restrictedUsers: room.restrictedUsers });
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    // Join logic remains the same...
    
    // --- Message Events ---
    socket.on('chat-message', async ({ roomCode, message, replyTo }) => {
        const room = activeRooms[roomCode];
        if (room && room.users[socket.id]) {
            const username = room.users[socket.id];
            const messageData = {
                id: uuidv4(),
                username,
                message,
                replyTo, // ID of message being replied to
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            db.data.rooms[roomCode].messages.push(messageData);
            await db.write();
            io.to(roomCode).emit('chat-message', messageData);
        }
    });

    socket.on('edit-message', async ({ roomCode, messageId, newMessage }) => {
        await db.read();
        const room = db.data.rooms[roomCode];
        const message = room.messages.find(m => m.id === messageId);
        if (message && message.username === activeRooms[roomCode].users[socket.id]) {
            message.message = newMessage;
            message.edited = true;
            await db.write();
            io.to(roomCode).emit('message-edited', { messageId, newMessage });
        }
    });

    socket.on('delete-message', async ({ roomCode, messageId }) => {
        await db.read();
        const room = db.data.rooms[roomCode];
        const messageIndex = room.messages.findIndex(m => m.id === messageId);
        if (messageIndex > -1 && room.messages[messageIndex].username === activeRooms[roomCode].users[socket.id]) {
            room.messages.splice(messageIndex, 1);
            await db.write();
            io.to(roomCode).emit('message-deleted', messageId);
        }
    });

    // --- Moderation Events ---
    socket.on('kick-user', ({ roomCode, username }) => {
        const targetSocketId = Object.keys(activeRooms[roomCode].users).find(id => activeRooms[roomCode].users[id] === username);
        if (targetSocketId) {
            io.to(targetSocketId).emit('kicked');
            io.sockets.sockets.get(targetSocketId)?.disconnect();
        }
    });

    socket.on('ban-user', async ({ roomCode, username }) => {
        await db.read();
        const room = db.data.rooms[roomCode];
        if (room && !room.bannedUsers.includes(username)) {
            room.bannedUsers.push(username);
            await db.write();
            io.to(roomCode).emit('user-banned', username);
            const targetSocketId = Object.keys(activeRooms[roomCode].users).find(id => activeRooms[roomCode].users[id] === username);
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked');
                io.sockets.sockets.get(targetSocketId)?.disconnect();
            }
        }
    });

    socket.on('clear-chat', async ({ roomCode }) => {
        await db.read();
        db.data.rooms[roomCode].messages = [];
        await db.write();
        io.to(roomCode).emit('chat-cleared');
    });

    // Other events (join, disconnect, typing, etc.) remain largely the same
});

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
