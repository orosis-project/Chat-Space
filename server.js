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

const hasPermission = (username, action, rolesData, permissionsData) => {
    const userRole = rolesData[username];
    const requiredRole = permissionsData[action];
    if (!userRole || !requiredRole) return false;
    return ROLES.indexOf(userRole) >= ROLES.indexOf(requiredRole);
};

const logAuditEvent = async (actor, action, details) => {
    try {
        await db.read();
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
        db.data = db.data || {};
        db.data.users = db.data.users || {};
        db.data.chatData = db.data.chatData || {};

        const defaults = {
            channels: { 'general': { messages: [], private: false, members: [], creator: 'System' } },
            dms: {}, userRelations: {}, settings: { chatPaused: false }, roles: {},
            bans: { normal: [], silent: [] }, loggedMessages: {}, auditLog: [], mutes: {},
            permissions: {
                createBranch: 'Member', createPrivateBranch: 'Moderator',
            }
        };

        for (const key in defaults) {
            if (!db.data.chatData[key]) db.data.chatData[key] = defaults[key];
        }
        
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
app.get('/api/hf-token', (req, res) => {
    if (process.env.HUGGING_FACE_TOKEN) {
        res.json({ token: process.env.HUGGING_FACE_TOKEN });
    } else {
        res.status(500).json({ message: "Hugging Face token not configured on the server." });
    }
});

app.get('/api/giphy-key', (req, res) => {
    if (process.env.GIPHY_API_KEY) {
        res.json({ apiKey: process.env.GIPHY_API_KEY });
    } else {
        res.status(500).json({ message: "GIPHY API key not configured on the server." });
    }
});

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
    const { username } = socket.handshake.auth;
    if (!username) return socket.disconnect();

    try {
        await db.read();
        const userData = db.data.users[username];
        if (!userData) return socket.disconnect();

        const userRole = db.data.chatData.roles[username] || 'Member';
        activeUsers[username] = { socketId: socket.id, role: userRole, nickname: userData.nickname, icon: userData.icon, username };
        
        const visibleChannels = Object.entries(db.data.chatData.channels).reduce((acc, [id, channel]) => {
            if (!channel.private || channel.members.includes(username)) {
                acc[id] = channel;
            }
            return acc;
        }, {});

        Object.keys(visibleChannels).forEach(channelId => socket.join(channelId));

        socket.emit('join-successful', {
            allUsers: db.data.users, 
            channels: visibleChannels,
            roles: db.data.chatData.roles, 
            permissions: db.data.chatData.permissions,
            currentUserData: userData,
            username: username,
            role: userRole,
            nickname: userData.nickname,
        });

        io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });

    } catch (error) {
        console.error("Error during user connection setup:", error);
        return socket.disconnect();
    }
    
    socket.on('disconnect', () => {
        delete activeUsers[username];
        io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });
    });

    socket.on('send-message', async ({ channel, message, type = 'text' }) => {
        await db.read();
        const { channels } = db.data.chatData;
        if (!channels[channel]) return;

        const messageObject = {
            id: uuidv4(), author: username, nickname: activeUsers[username].nickname,
            content: message, timestamp: Date.now(), icon: activeUsers[username].icon, type
        };
        
        channels[channel].messages.push(messageObject);
        await db.write();
        io.to(channel).emit('new-message', { channel, message: messageObject });
    });

    socket.on('create-channel', async ({ channelName, isPrivate }) => {
        await db.read();
        const { roles, permissions, channels } = db.data.chatData;
        const requiredPermission = isPrivate ? 'createPrivateBranch' : 'createBranch';

        if (!hasPermission(username, requiredPermission, roles, permissions)) {
            return socket.emit('system-message', { text: `You don't have permission to create ${isPrivate ? 'private' : 'public'} branches.` });
        }
        if (channels[channelName]) {
            return socket.emit('system-message', { text: `A branch named #${channelName} already exists.` });
        }
        
        channels[channelName] = { messages: [], private: isPrivate, creator: username, members: isPrivate ? [username] : [] };
        await db.write();
        
        socket.join(channelName);

        if (isPrivate) {
            socket.emit('channels-updated', channels);
        } else {
            io.emit('channels-updated', channels);
            io.sockets.sockets.forEach(s => s.join(channelName));
        }

        await logAuditEvent(username, `Created ${isPrivate ? 'Private' : 'Public'} Branch`, `#${channelName}`);
    });
});

initializeServer();
