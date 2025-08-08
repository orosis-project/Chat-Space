// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { JSONFile, Low } = require('lowdb');

// --- Database Setup ---
const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter);

async function initializeDatabase() {
    await db.read();
    // The DB now stores room details including the owner and hashed password
    db.data = db.data || { rooms: {} }; // { roomCode: { owner, passwordHash, messages } }
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
const activeRooms = {}; // { roomCode: { users: { socketId: username }, typing: [] } }

// --- Routes ---
app.get('/chat', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Route to create a new room with a password
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

    db.data.rooms[roomCode] = { owner: username, passwordHash, messages: [] };
    await db.write();
    
    activeRooms[roomCode] = { users: {}, typing: [] };
    res.status(201).json({ message: "Room created successfully." });
});

// Route to log into an existing room
app.post('/login-room', async (req, res) => {
    const { roomCode, password } = req.body;
    await db.read();
    const room = db.data.rooms[roomCode];

    if (!room) {
        return res.status(404).json({ message: "Room not found." });
    }

    const isMatch = await bcrypt.compare(password, room.passwordHash);
    if (!isMatch) {
        return res.status(401).json({ message: "Invalid password." });
    }
    
    // Ensure the room is initialized in the active rooms list if server restarted
    if (!activeRooms[roomCode]) {
        activeRooms[roomCode] = { users: {}, typing: [] };
    }

    res.status(200).json({ message: "Login successful." });
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('join-room', async ({ roomCode, username }) => {
        if (activeRooms[roomCode]) {
            socket.join(roomCode);
            activeRooms[roomCode].users[socket.id] = username;

            await db.read();
            const previousMessages = db.data.rooms[roomCode]?.messages || [];
            socket.emit('previous-messages', previousMessages);

            const userList = Object.values(activeRooms[roomCode].users);
            io.to(roomCode).emit('user-joined', { username, userList });
        } else {
            socket.emit('error', 'Room not found or server error.');
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
    
    socket.on('image-message', async (data) => {
        const { roomCode, image } = data;
        const room = activeRooms[roomCode];
        if (room && room.users[socket.id]) {
            const username = room.users[socket.id];
            const messageData = {
                username,
                image,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            db.data.rooms[roomCode].messages.push(messageData);
            await db.write();
            io.to(roomCode).emit('image-message', messageData);
        }
    });

    socket.on('typing', (roomCode) => {
        const room = activeRooms[roomCode];
        if (room && room.users[socket.id]) {
            const username = room.users[socket.id];
            if (!room.typing.includes(username)) {
                room.typing.push(username);
            }
            io.to(roomCode).emit('typing', room.typing);
        }
    });

    socket.on('stop-typing', (roomCode) => {
        const room = activeRooms[roomCode];
        if (room && room.users[socket.id]) {
            const username = room.users[socket.id];
            room.typing = room.typing.filter(u => u !== username);
            io.to(roomCode).emit('typing', room.typing);
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
