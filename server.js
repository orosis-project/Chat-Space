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
const db = new Low(adapter, { users: {}, rooms: {}, dms: {} });

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static('public'));

const activeUsers = {}; // { socketId: username }

// --- Server Startup ---
async function startServer() {
    try {
        await db.read();
        db.data = db.data || { users: {}, rooms: {}, dms: {} };
        await db.write();
        server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("FATAL: Could not start server.", error);
        process.exit(1);
    }
}

// --- Routes ---
// ... (All routes from previous correct version)

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    socket.on('join-request', async ({ roomCode, username }) => {
        try {
            socket.join(roomCode);
            activeUsers[socket.id] = username;
            
            await db.read();
            const roomData = db.data.rooms[roomCode];
            
            socket.emit('join-successful', {
                previousMessages: roomData.messages || [],
                isOwner: roomData.owner === username
            });
            
            io.to(roomCode).emit('user-list-update', Object.values(activeUsers));
        } catch (error) {
            socket.emit('error', 'Failed to join room on server.');
        }
    });

    socket.on('chat-message', async (data) => {
        try {
            const { roomCode, message } = data;
            const from = activeUsers[socket.id];
            if (from) {
                const messageData = {
                    id: uuidv4(),
                    from,
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

    socket.on('get-dm-history', async ({ partner }) => {
        const self = activeUsers[socket.id];
        const dmKey = [self, partner].sort().join('-');
        await db.read();
        const history = db.data.dms[dmKey] || [];
        socket.emit('dm-history', history);
    });

    socket.on('send-dm', async ({ to, message }) => {
        const from = activeUsers[socket.id];
        const dmKey = [from, to].sort().join('-');
        const messageData = {
            from,
            to,
            message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        await db.read();
        if (!db.data.dms[dmKey]) db.data.dms[dmKey] = [];
        db.data.dms[dmKey].push(messageData);
        await db.write();

        // Send to recipient if they are online
        const recipientSocketId = Object.keys(activeUsers).find(id => activeUsers[id] === to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('receive-dm', messageData);
        }
        // Send back to self for confirmation
        socket.emit('receive-dm', messageData);
    });

    socket.on('disconnect', () => {
        const username = activeUsers[socket.id];
        delete activeUsers[socket.id];
        io.emit('user-list-update', Object.values(activeUsers));
    });
});

startServer();
