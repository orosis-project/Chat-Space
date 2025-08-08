// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity. For production, restrict this to your frontend's URL.
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// In-memory "database" for simplicity
const users = {}; // Stores { socketId: username }
const rooms = {}; // Stores { roomCode: { users: [socketId], messages: [] } }

app.use(express.static('public'));

// This route now serves the main chat application page
app.get('/chat', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// API endpoint to create a new room and get a code
app.post('/create-room', (req, res) => {
    let roomCode;
    do {
        roomCode = uuidv4().substring(0, 6); // Generate a 6-character unique code
    } while (rooms[roomCode]);

    rooms[roomCode] = { users: [], messages: [] };
    res.json({ roomCode });
});


io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // User sets their username
    socket.on('set-username', (username) => {
        users[socket.id] = username;
        console.log(`User ${socket.id} set username to ${username}`);
    });

    // User joins a room
    socket.on('join-room', (roomCode) => {
        if (rooms[roomCode]) {
            socket.join(roomCode);
            rooms[roomCode].users.push(socket.id);
            const username = users[socket.id] || 'Anonymous';

            // Send previous messages to the user
            socket.emit('previous-messages', rooms[roomCode].messages);

            // Notify others in the room
            socket.to(roomCode).emit('user-joined', `${username} has joined the room.`);
            console.log(`User ${username} (${socket.id}) joined room ${roomCode}`);
        } else {
            socket.emit('error', 'Room not found');
        }
    });

    // User sends a message
    socket.on('chat-message', (data) => {
        const { roomCode, message } = data;
        const username = users[socket.id] || 'Anonymous';
        if (rooms[roomCode]) {
            const messageData = { username, message, timestamp: new Date() };
            rooms[roomCode].messages.push(messageData);
            io.to(roomCode).emit('chat-message', messageData);
        }
    });

    // "User is typing" indicator
    socket.on('typing', (data) => {
        const { roomCode } = data;
        const username = users[socket.id] || 'Anonymous';
        socket.to(roomCode).emit('typing', `${username} is typing...`);
    });

    socket.on('stop-typing', (roomCode) => {
        socket.to(roomCode).emit('stop-typing');
    });

    // User disconnects
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        const username = users[socket.id];
        delete users[socket.id];

        // Remove user from any rooms they were in
        for (const roomCode in rooms) {
            const index = rooms[roomCode].users.indexOf(socket.id);
            if (index !== -1) {
                rooms[roomCode].users.splice(index, 1);
                io.to(roomCode).emit('user-left', `${username} has left the room.`);
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
