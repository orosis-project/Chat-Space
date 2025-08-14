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
const activeUsers = {}; // { username: { socketId, role, icon, nickname } }
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

// --- API Routes ---
app.post('/join', (req, res) => {
    if (req.body.code === MAIN_CHAT_CODE) {
        res.status(200).json({ message: "Access granted." });
    } else {
        res.status(401).json({ message: "Invalid Join Code." });
    }
});

app.post('/login', async (req, res) => {
    await db.read();
    const { username, password } = req.body;
    const user = db.data.users[username];
    if (user) {
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });
    } else {
        const salt = await bcrypt.genSalt(10);
        db.data.users[username] = { passwordHash: await bcrypt.hash(password, salt), nickname: username, icon: 'default' };
        db.data.chatData.roles[username] = 'Member';
        await db.write();
    }
    const role = db.data.chatData.roles[username] || 'Member';
    const nickname = db.data.users[username].nickname || username;
    res.status(200).json({ username, role, nickname });
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('user-connect', async ({ username, role, nickname }) => {
        await db.read();
        currentUsername = username;
        activeUsers[username] = { socketId: socket.id, role, nickname, icon: db.data.users[username]?.icon || 'default' };
        
        Object.keys(db.data.chatData.channels).forEach(channel => socket.join(channel));
        Object.keys(db.data.chatData.dms).forEach(dmKey => {
            if (dmKey.includes(username)) socket.join(dmKey);
        });
        socket.join(username);

        socket.emit('join-successful', {
            settings: db.data.chatData.settings,
            channels: db.data.chatData.channels,
            dms: db.data.chatData.dms,
            currentUser: { username, role, nickname, icon: activeUsers[username].icon },
            allUsers: db.data.users,
            roles: db.data.chatData.roles,
            userRelations: db.data.chatData.userRelations[username] || { friends: [], blocked: [] }
        });

        io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });
    });

    socket.on('disconnect', () => {
        if (currentUsername) {
            delete activeUsers[currentUsername];
            io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });
        }
    });

    socket.on('send-message', async ({ channel, message, replyingTo }) => {
        const { cleanMessage } = filterMessage(message);
        const messageObject = {
            id: uuidv4(), author: currentUsername, nickname: activeUsers[currentUsername].nickname,
            content: cleanMessage, timestamp: Date.now(), icon: activeUsers[currentUsername].icon,
            pinned: false, reactions: {}, replyingTo: replyingTo || null
        };
        
        db.data.chatData.channels[channel].messages.push(messageObject);
        await db.write();
        io.to(channel).emit('new-message', { channel, message: messageObject });

        const mentionedUsers = [...message.matchAll(/@([a-zA-Z0-9_ ;)]+)/g)].map(match => match[1].trim());
        mentionedUsers.forEach(mentionedUser => {
            if (activeUsers[mentionedUser]) {
                io.to(activeUsers[mentionedUser].socketId).emit('notification', {
                    title: `Mention from ${activeUsers[currentUsername].nickname} in #${channel}`,
                    body: message
                });
            }
        });
    });

    socket.on('send-dm', async ({ recipient, message }) => {
        const dmKey = [currentUsername, recipient].sort().join('-');
        db.data.chatData.dms[dmKey] = db.data.chatData.dms[dmKey] || { messages: [] };
        
        const messageObject = {
            id: uuidv4(), sender: currentUsername, senderNickname: activeUsers[currentUsername].nickname,
            content: message, timestamp: Date.now(), reactions: {}
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
        } else {
            message = db.data.chatData.dms[chatId]?.messages.find(m => m.id === messageId);
        }
        if (!message) return;

        message.reactions = message.reactions || {};
        message.reactions[emoji] = message.reactions[emoji] || [];
        
        const userIndex = message.reactions[emoji].indexOf(currentUsername);
        (userIndex > -1) ? message.reactions[emoji].splice(userIndex, 1) : message.reactions[emoji].push(currentUsername);
        
        await db.write();
        io.to(chatId).emit('reaction-updated', { chatType, chatId, messageId, reactions: message.reactions });
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
        
        const updateSet = (arr, val) => new Set(arr).add(val);
        const removeVal = (arr, val) => arr.filter(item => item !== val);

        if (type === 'friend') relations.friends = [...updateSet(relations.friends, targetUser)];
        else if (type === 'block') relations.blocked = [...updateSet(relations.blocked, targetUser)];
        else if (type === 'unfriend') relations.friends = removeVal(relations.friends, targetUser);
        else if (type === 'unblock') relations.blocked = removeVal(relations.blocked, targetUser);
        
        await db.write();
        socket.emit('relations-updated', relations);
    });
});

initializeServer();
