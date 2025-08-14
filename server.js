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
const db = new Low(adapter, { users: {}, chatData: {} });

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Constants & State ---
const MAIN_CHAT_CODE = "HMS";
const HEIM_BOT_ICON = 'https://resources.finalsite.net/images/f_auto,q_auto,t_image_size_2/v1700469524/williamsvillek12org/zil1pj6ifch1f4h14oid/8HEIMMIDDLE.png';
const activeUsers = {}; // { username: { socketId, role, icon, nickname } }
const messageTimestamps = {};
const cooldowns = {};

const inappropriateWords = ['badword1', 'profanity2', 'swear3', 'examplebadword', 'anotherexample'];

// --- Utility Functions ---
const hasPermission = (username, requiredRole) => {
    const userRole = db.data.chatData.roles[username];
    if (!userRole) return false;
    const roles = ['Member', 'Moderator', 'Co-Owner', 'Owner'];
    return roles.indexOf(userRole) >= roles.indexOf(requiredRole);
};

const filterMessage = (message) => {
    let cleanMessage = message;
    let flagged = false;
    inappropriateWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        if (regex.test(cleanMessage)) {
            flagged = true;
            cleanMessage = cleanMessage.replace(regex, '*******');
        }
    });
    return { cleanMessage, flagged };
};

// --- Initial Server Setup ---
async function initializeServer() {
    try {
        await db.read();
        db.data = db.data || { users: {}, chatData: {} };

        if (!db.data.chatData.channels) {
            db.data.chatData = {
                channels: { 'general': { messages: [] } },
                dms: {}, // { 'user1-user2': { messages: [] } }
                userRelations: {}, // { username: { friends: [], blocked: [] } }
                settings: { backgroundUrl: '' },
                roles: {},
                bans: [],
                flaggedMessages: []
            };
        }

        const ownerUsername = "Austin ;)"
        if (!db.data.users[ownerUsername]) {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash("AME", salt);
            db.data.users[ownerUsername] = { passwordHash, nickname: ownerUsername, icon: 'default' };
            db.data.chatData.roles[ownerUsername] = 'Owner';
        }

        await db.write();
        server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("FATAL: Could not start server.", error);
        process.exit(1);
    }
}

// --- API Routes (Unchanged) ---
app.post('/join', (req, res) => { /* ... */ });
app.post('/login', async (req, res) => { /* ... */ });

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('user-connect', async ({ username, role, nickname }) => {
        await db.read();
        currentUsername = username;
        activeUsers[username] = { socketId: socket.id, role, nickname, icon: db.data.users[username]?.icon || 'default' };
        
        Object.keys(db.data.chatData.channels).forEach(channel => socket.join(channel));
        socket.join(username); // Private room for DMs

        socket.emit('join-successful', {
            settings: db.data.chatData.settings,
            channels: db.data.chatData.channels,
            dms: db.data.chatData.dms,
            currentUser: { username, role, nickname, icon: activeUsers[username].icon },
            allUsers: db.data.users,
            roles: db.data.chatData.roles,
            userRelations: db.data.chatData.userRelations[username] || { friends: [], blocked: [] }
        });

        io.emit('update-user-list', { activeUsers, allUsers: Object.keys(db.data.users) });
    });

    socket.on('disconnect', () => {
        if (currentUsername) {
            delete activeUsers[currentUsername];
            io.emit('update-user-list', { activeUsers, allUsers: Object.keys(db.data.users) });
        }
    });

    socket.on('send-message', async ({ channel, message, replyingTo }) => {
        const { cleanMessage, flagged } = filterMessage(message);
        // ... (flagged message logic)

        const messageObject = {
            id: uuidv4(),
            author: currentUsername,
            nickname: activeUsers[currentUsername].nickname,
            content: cleanMessage,
            timestamp: Date.now(),
            icon: activeUsers[currentUsername].icon,
            pinned: false,
            reactions: {},
            replyingTo: replyingTo || null
        };
        
        db.data.chatData.channels[channel].messages.push(messageObject);
        await db.write();
        io.to(channel).emit('new-message', { channel, message: messageObject });

        // Mention notifications
        const mentionedUsers = [...message.matchAll(/@([a-zA-Z0-9_ ;)]+)/g)].map(match => match[1].trim());
        mentionedUsers.forEach(mentionedUser => {
            if (activeUsers[mentionedUser]) {
                io.to(activeUsers[mentionedUser].socketId).emit('notification', {
                    title: `You were mentioned by ${activeUsers[currentUsername].nickname} in #${channel}`,
                    body: message
                });
            }
        });
    });

    socket.on('send-dm', async ({ recipient, message }) => {
        const dmKey = [currentUsername, recipient].sort().join('-');
        db.data.chatData.dms[dmKey] = db.data.chatData.dms[dmKey] || { messages: [] };
        
        const messageObject = {
            id: uuidv4(),
            sender: currentUsername,
            content: message,
            timestamp: Date.now()
        };
        db.data.chatData.dms[dmKey].messages.push(messageObject);
        await db.write();

        const recipientSocket = activeUsers[recipient]?.socketId;
        if (recipientSocket) {
            io.to(recipientSocket).emit('new-dm', { dmKey, message: messageObject, partner: currentUsername });
        }
        socket.emit('new-dm', { dmKey, message: messageObject, partner: recipient });
    });

    socket.on('toggle-reaction', async ({ chatType, chatId, messageId, emoji }) => {
        let message;
        if (chatType === 'channel') {
            message = db.data.chatData.channels[chatId]?.messages.find(m => m.id === messageId);
        } else { // dm
            message = db.data.chatData.dms[chatId]?.messages.find(m => m.id === messageId);
        }
        if (!message) return;

        message.reactions = message.reactions || {};
        message.reactions[emoji] = message.reactions[emoji] || [];
        
        const userIndex = message.reactions[emoji].indexOf(currentUsername);
        if (userIndex > -1) {
            message.reactions[emoji].splice(userIndex, 1);
        } else {
            message.reactions[emoji].push(currentUsername);
        }
        
        await db.write();
        io.to(chatId).emit('reaction-updated', { chatId, messageId, reactions: message.reactions });
    });

    socket.on('toggle-pin', async ({ channel, messageId }) => {
        if (!hasPermission(currentUsername, 'Owner')) return;
        const message = db.data.chatData.channels[channel]?.messages.find(m => m.id === messageId);
        if (!message) return;

        message.pinned = !message.pinned;
        await db.write();
        io.to(channel).emit('pin-updated', { channel, messageId, pinned: message.pinned });
    });

    socket.on('update-relation', async ({ targetUser, type }) => {
        db.data.chatData.userRelations[currentUsername] = db.data.chatData.userRelations[currentUsername] || { friends: [], blocked: [] };
        const relations = db.data.chatData.userRelations[currentUsername];
        
        if (type === 'friend') {
            if (!relations.friends.includes(targetUser)) relations.friends.push(targetUser);
        } else if (type === 'block') {
            if (!relations.blocked.includes(targetUser)) relations.blocked.push(targetUser);
        } else if (type === 'unfriend') {
            relations.friends = relations.friends.filter(f => f !== targetUser);
        } else if (type === 'unblock') {
            relations.blocked = relations.blocked.filter(b => b !== targetUser);
        }
        
        await db.write();
        socket.emit('relations-updated', relations);
    });

    // ... other handlers like create-channel, profile updates, etc.
});

initializeServer();
