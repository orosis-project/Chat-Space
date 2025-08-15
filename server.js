// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, { users: {}, chatData: {} });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAIN_CHAT_CODE = "HMS";
const activeUsers = {}; 
const ROLES = ['Member', 'Moderator', 'Co-Owner', 'Owner'];
const activeTypers = {};
const activeGames = {};
const lastMessageTimestamps = {};

const hasPermission = (username, action, rolesData, permissionsData) => {
    const userRole = rolesData[username];
    const requiredRole = permissionsData[action];
    if (!userRole || !requiredRole) return false;
    return ROLES.indexOf(userRole) >= ROLES.indexOf(requiredRole);
};

const canActOn = (actorUsername, targetUsername, rolesData) => {
    const actorRoleIndex = ROLES.indexOf(rolesData[actorUsername]);
    const targetRoleIndex = ROLES.indexOf(rolesData[targetUsername]);
    if (targetRoleIndex === -1) return true;
    return actorRoleIndex > targetRoleIndex;
};

const logAuditEvent = async (actor, action, details) => {
    try {
        db.data.chatData.auditLog.unshift({ timestamp: Date.now(), actor, action, details });
        if (db.data.chatData.auditLog.length > 200) db.data.chatData.auditLog.pop();
        await db.write();
    } catch (e) {
        console.error("Failed to log audit event:", e);
    }
};

async function initializeServer() {
    try {
        await db.read();
        db.data.users = db.data.users || {};
        db.data.chatData = db.data.chatData || {};

        const defaults = {
            channels: { 'general': { messages: [], private: false, creator: 'System', slowMode: 0 } },
            dms: {}, userRelations: {}, settings: { chatPaused: false }, roles: {},
            bans: { normal: [], silent: [] }, loggedMessages: {}, auditLog: [], mutes: {},
            permissions: {
                sendMessage: 'Member', sendGiphy: 'Member', reactToMessage: 'Member',
                replyToMessage: 'Member', editOwnMessage: 'Member', deleteOwnMessage: 'Member',
                startDM: 'Member', addFriend: 'Member', blockUser: 'Member',
                createBranch: 'Member', createPrivateBranch: 'Moderator', inviteToBranch: 'Moderator',
                deleteAnyMessage: 'Moderator', viewUserProfile: 'Moderator', muteUser: 'Moderator',
                kickUser: 'Moderator', banUser: 'Moderator', silentBanUser: 'Moderator',
                clearChat: 'Owner', pauseChat: 'Owner', setSlowMode: 'Co-Owner',
                manageUsers: 'Co-Owner', viewAuditLog: 'Owner', viewPermissions: 'Owner', setPermissions: 'Owner'
            }
        };

        for (const key in defaults) {
            if (!db.data.chatData[key]) db.data.chatData[key] = defaults[key];
        }
        if (!db.data.chatData.bans.normal) db.data.chatData.bans.normal = [];
        if (!db.data.chatData.bans.silent) db.data.chatData.bans.silent = [];

        const ownerUsername = "Austin ;)";
        if (!db.data.users[ownerUsername]) {
            const salt = await bcrypt.genSalt(10);
            db.data.users[ownerUsername] = { passwordHash: await bcrypt.hash("AME", salt), nickname: "Austin ;)", icon: 'default', canCopy: true, hasAgreedToTerms: true, lastSeenRole: 'Owner' };
            db.data.chatData.roles[ownerUsername] = 'Owner';
        }
        if (!db.data.users["Heim Bot"]) {
            db.data.users["Heim Bot"] = { nickname: "Heim Bot", icon: 'https://resources.finalsite.net/images/f_auto,q_auto,t_image_size_2/v1700469524/williamsvillek12org/zil1pj6ifch1f4h14oid/8HEIMMIDDLE.png', canCopy: true };
            db.data.chatData.roles["Heim Bot"] = 'Bot';
        }

        await db.write();
        server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("FATAL: Could not initialize server.", error);
        process.exit(1);
    }
}

// --- API Routes ---
app.get('/api/giphy-key', (req, res) => res.json({ apiKey: process.env.GIPHY_API_KEY }));

app.post('/join', (req, res) => {
    if (req.body.code === MAIN_CHAT_CODE) res.status(200).json({ message: "Access granted." });
    else res.status(401).json({ message: "Invalid Join Code." });
});

app.post('/login', async (req, res) => {
    await db.read();
    const { username, password } = req.body;
    if (db.data.chatData.bans.normal.includes(username)) {
        return res.status(403).json({ message: "You are banned from this chat." });
    }
    const user = db.data.users[username];
    if (user && user.passwordHash) {
        if (!await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ message: "Invalid credentials." });
    } else if (!user) {
        const salt = await bcrypt.genSalt(10);
        db.data.users[username] = { passwordHash: await bcrypt.hash(password, salt), nickname: username, icon: 'default', canCopy: true, hasAgreedToTerms: false, lastSeenRole: null };
        db.data.chatData.roles[username] = 'Member';
        await db.write();
    }
    const role = db.data.chatData.roles[username] || 'Member';
    const nickname = db.data.users[username].nickname || username;
    res.status(200).json({ username, role, nickname });
});

io.on('connection', async (socket) => {
    const { username, role, nickname } = socket.handshake.auth;

    if (!username) {
        return socket.disconnect();
    }

    const currentUsername = username;
    let userNickname = nickname;

    try {
        await db.read();
        const userData = db.data.users[currentUsername];
        if (!userData) {
            return socket.disconnect();
        }
        userNickname = userData.nickname || nickname;

        activeUsers[currentUsername] = { socketId: socket.id, role, nickname: userNickname, icon: userData?.icon, status: 'online' };
        
        Object.keys(db.data.chatData.channels).forEach(channelId => {
            socket.join(channelId);
        });

        socket.emit('join-successful', {
            allUsers: db.data.users, 
            channels: db.data.chatData.channels, 
            dms: db.data.chatData.dms,
            roles: db.data.chatData.roles, 
            permissions: db.data.chatData.permissions,
            userRelations: db.data.chatData.userRelations[currentUsername] || { friends: [], blocked: [] },
            currentUserData: userData,
            username: currentUsername,
            role: db.data.chatData.roles[currentUsername],
            nickname: userNickname,
            icon: userData.icon
        });

        io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });

    } catch (error) {
        console.error("Error during user connection setup:", error);
        return socket.disconnect();
    }
    
    socket.on('disconnect', () => {
        if (currentUsername) {
            delete activeUsers[currentUsername];
            Object.keys(activeTypers).forEach(channel => {
                if (activeTypers[channel] && activeTypers[channel].delete(userNickname)) {
                    io.to(channel).emit('typing-update', { channel, typers: Array.from(activeTypers[channel]) });
                }
            });
            io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });
        }
    });

    socket.on('send-message', async ({ channel, message, replyingTo, type = 'text' }) => {
        const { roles, permissions, bans, settings, channels } = db.data.chatData;
        if (!hasPermission(currentUsername, 'sendMessage', roles, permissions)) return;
        if (bans.silent.includes(currentUsername)) return;
        if (settings.chatPaused && !hasPermission(currentUsername, 'pauseChat', roles, permissions)) {
            return socket.emit('system-message', { text: "Chat is currently paused." });
        }
        const now = Date.now();
        const slowMode = channels[channel]?.slowMode || 0;
        if (now - (lastMessageTimestamps[currentUsername] || 0) < slowMode * 1000) {
            return socket.emit('system-message', { text: `Slow mode is active. Please wait ${slowMode} seconds.` });
        }
        lastMessageTimestamps[currentUsername] = now;

        const messageObject = {
            id: uuidv4(), author: currentUsername, nickname: activeUsers[currentUsername].nickname,
            content: message, timestamp: now, icon: activeUsers[currentUsername].icon,
            pinned: false, reactions: {}, replyingTo: replyingTo || null, type: type
        };
        
        channels[channel].messages.push(messageObject);
        await db.write();
        io.to(channel).emit('new-message', { channel, message: messageObject });
    });

    // **NEW:** Handle channel creation
    socket.on('create-channel', async ({ channelName }) => {
        const { roles, permissions, channels } = db.data.chatData;
        if (!hasPermission(currentUsername, 'createBranch', roles, permissions)) {
            return socket.emit('system-message', { text: "You don't have permission to create branches." });
        }
        if (channels[channelName]) {
            return socket.emit('system-message', { text: `A branch named #${channelName} already exists.` });
        }
        
        channels[channelName] = { messages: [], private: false, creator: currentUsername, slowMode: 0 };
        await db.write();
        
        // Notify all clients about the new channel list
        io.emit('channels-updated', channels);
        
        // Automatically make the creator and all other connected users join the new room
        io.sockets.sockets.forEach((sock) => {
            sock.join(channelName);
        });

        await logAuditEvent(currentUsername, 'Created Branch', `#${channelName}`);
    });

    socket.on('edit-message', async ({ channel, messageId, newContent }) => {
        const message = db.data.chatData.channels[channel]?.messages.find(m => m.id === messageId);
        if (message && message.author === currentUsername) {
            message.content = newContent;
            message.edited = true;
            await db.write();
            io.to(channel).emit('message-updated', { channel, messageId, newContent });
        }
    });

    socket.on('delete-message', async ({ channel, messageId }) => {
        const { roles, permissions, channels } = db.data.chatData;
        const messages = channels[channel]?.messages;
        const message = messages?.find(m => m.id === messageId);
        if (message && (message.author === currentUsername || hasPermission(currentUsername, 'deleteAnyMessage', roles, permissions))) {
            channels[channel].messages = messages.filter(m => m.id !== messageId);
            await db.write();
            io.to(channel).emit('message-deleted', { channel, messageId });
            await logAuditEvent(currentUsername, 'Deleted Message', `In #${channel}`);
        }
    });

    socket.on('start-typing', ({ channel }) => {
        if (!activeTypers[channel]) activeTypers[channel] = new Set();
        activeTypers[channel].add(activeUsers[currentUsername]?.nickname || currentUsername);
        io.to(channel).emit('typing-update', { channel, typers: Array.from(activeTypers[channel]) });
    });
    
    socket.on('stop-typing', ({ channel }) => {
        if (activeTypers[channel]) {
            activeTypers[channel].delete(activeUsers[currentUsername]?.nickname || currentUsername);
            io.to(channel).emit('typing-update', { channel, typers: Array.from(activeTypers[channel]) });
        }
    });

    socket.on('mute-user', async ({ targetUsername, durationMinutes }) => {
        const { roles, permissions } = db.data.chatData;
        if (hasPermission(currentUsername, 'muteUser', roles, permissions) && canActOn(currentUsername, targetUsername, roles)) {
            const muteUntil = Date.now() + durationMinutes * 60 * 1000;
            db.data.chatData.mutes[targetUsername] = muteUntil;
            await db.write();
            await logAuditEvent(currentUsername, 'Muted User', `${targetUsername} for ${durationMinutes} min`);
            io.emit('system-message', { text: `${targetUsername} was muted by ${currentUsername} for ${durationMinutes} minutes.` });
        }
    });

    socket.on('start-trivia', async ({ channel }) => {
        if (activeGames[channel]) return;
        const questions = [{ q: "What is the capital of France?", a: "Paris" }, { q: "2 + 2 = ?", a: "4" }];
        activeGames[channel] = { type: 'trivia', questions, current: 0, scores: {} };
        io.to(channel).emit('game-started', { type: 'trivia', question: questions[0].q });
    });

    socket.on('game-answer', ({ channel, answer }) => {
        const game = activeGames[channel];
        if (game && game.type === 'trivia' && answer.toLowerCase() === game.questions[game.current].a.toLowerCase()) {
            game.scores[currentUsername] = (game.scores[currentUsername] || 0) + 1;
            game.current++;
            if (game.current >= game.questions.length) {
                io.to(channel).emit('game-over', { scores: game.scores });
                delete activeGames[channel];
            } else {
                io.to(channel).emit('game-update', { question: game.questions[game.current].q, scores: game.scores });
            }
        }
    });
});

initializeServer();
