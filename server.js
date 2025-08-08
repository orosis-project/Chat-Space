// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node'); // Corrected import

// --- Database Setup ---
const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter);

async function initializeDatabase() {
    await db.read();
    // The DB now stores room details including the owner and hashed password
    db.data = db.data || { rooms: {} }; // { roomCode: { owner, passwordHash, mode, restrictedUsers, messages } }
    await db.write();
}
initializeDatabase();

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.static('public'));

// In-memory store for active users and rooms
const activeRooms = {}; // { roomCode: { users: { socketId: username }, typing: [], pending: {} } }

// --- Routes ---
app.get('/chat', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/create-room', async (req, res) => {
    const { roomCode, username, password } = req.body;
    if (!roomCode || !username || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }

    await db.read();
    if (db.data.rooms[roomCode]) {
        return res.status(409).json({ message: "Room code already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    db.data.rooms[roomCode] = { owner: username, passwordHash, mode: 'open', restrictedUsers: [], messages: [] };
    await db.write();
    
    activeRooms[roomCode] = { users: {}, typing: [], pending: {} };
    res.status(201).json({ message: "Room created successfully." });
});

app.post('/login-room', async (req, res) => {
    const { roomCode, username, password } = req.body;
    await db.read();
    const room = db.data.rooms[roomCode];

    if (!room) return res.status(404).json({ message: "Room not found." });

    const isMatch = await bcrypt.compare(password, room.passwordHash);
    if (!isMatch) return res.status(401).json({ message: "Invalid password." });
    
    if (!activeRooms[roomCode]) activeRooms[roomCode] = { users: {}, typing: [], pending: {} };

    const isOwner = room.owner === username;
    res.status(200).json({ message: "Login successful.", isOwner, roomMode: room.mode, restrictedUsers: room.restrictedUsers });
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {

    const joinRoom = async (roomCode, username) => {
        socket.join(roomCode);
        activeRooms[roomCode].users[socket.id] = username;
        
        await db.read();
        const roomData = db.data.rooms[roomCode];
        socket.emit('join-successful', {
            previousMessages: roomData.messages || [],
            isRestricted: roomData.restrictedUsers.includes(username)
        });

        const userList = Object.values(activeRooms[roomCode].users);
        io.to(roomCode).emit('user-joined', { username, userList });
    };

    socket.on('join-request', async ({ roomCode, username }) => {
        await db.read();
        const room = db.data.rooms[roomCode];
        const ownerSocketId = Object.keys(activeRooms[roomCode].users).find(id => activeRooms[roomCode].users[id] === room.owner);

        switch (room.mode) {
            case 'open':
                joinRoom(roomCode, username);
                break;
            case 'approve':
                activeRooms[roomCode].pending[socket.id] = username;
                socket.emit('waiting-for-approval');
                if (ownerSocketId) {
                    io.to(ownerSocketId).emit('user-waiting-approval', { socketId: socket.id, username });
                }
                break;
            case 'restricted':
                if (!room.restrictedUsers.includes(username)) {
                    room.restrictedUsers.push(username);
                    await db.write();
                }
                joinRoom(roomCode, username);
                break;
        }
    });

    socket.on('approve-user', ({ roomCode, socketId }) => {
        const username = activeRooms[roomCode]?.pending[socketId];
        if (username) {
            joinRoom(roomCode, username);
            delete activeRooms[roomCode].pending[socketId];
        }
    });
    
    socket.on('promote-user', async ({ roomCode, username }) => {
        await db.read();
        const room = db.data.rooms[roomCode];
        if (room) {
            room.restrictedUsers = room.restrictedUsers.filter(u => u !== username);
            await db.write();
            io.to(roomCode).emit('user-promoted', { username, restrictedUsers: room.restrictedUsers });
        }
    });

    socket.on('change-room-mode', async ({ roomCode, mode }) => {
        await db.read();
        if (db.data.rooms[roomCode]) {
            db.data.rooms[roomCode].mode = mode;
            await db.write();
            io.to(roomCode).emit('room-mode-changed', mode);
        }
    });

    socket.on('chat-message', async (data) => {
        const { roomCode, message } = data;
        const room = activeRooms[roomCode];
        if (room && room.users[socket.id]) {
            const username = room.users[socket.id];
            const messageData = {
                username,
                message,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            db.data.rooms[roomCode].messages.push(messageData);
            await db.write();
            io.to(roomCode).emit('chat-message', messageData);
        }
    });
    
    socket.on('disconnect', () => {
        for (const roomCode in activeRooms) {
            const room = activeRooms[roomCode];
            if (room.users[socket.id]) {
                const username = room.users[socket.id];
                delete room.users[socket.id];
                
                const userList = Object.values(room.users);
                io.to(roomCode).emit('user-left', { username, userList });

                room.typing = room.typing.filter(u => u !== username);
                io.to(roomCode).emit('typing', room.typing);
                break;
            }
        }
    });
});


server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
