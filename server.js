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

const hasPermission = (username, action) => {
    const userRole = db.data.chatData.roles[username];
    const requiredRole = db.data.chatData.permissions[action];
    if (!userRole || !requiredRole) return false;
    return ROLES.indexOf(userRole) >= ROLES.indexOf(requiredRole);
};

async function initializeServer() {
    await db.read();
    db.data.users = db.data.users || {};
    db.data.chatData = {
        channels: { 'general': { messages: [], private: false, creator: 'System', slowMode: 0 } },
        dms: {}, userRelations: {}, settings: { chatPaused: false }, roles: {},
        bans: { normal: [], silent: [] }, loggedMessages: {}, auditLog: [],
        permissions: {
            // Social & Interaction
            sendMessage: 'Member', sendGiphy: 'Member', reactToMessage: 'Member',
            replyToMessage: 'Member', editOwnMessage: 'Member', deleteOwnMessage: 'Member',
            startDM: 'Member', addFriend: 'Member', blockUser: 'Member',
            // Branch Management
            createBranch: 'Member', createPrivateBranch: 'Moderator', inviteToBranch: 'Moderator',
            // Moderation
            deleteAnyMessage: 'Moderator', viewUserProfile: 'Moderator', muteUser: 'Moderator',
            kickUser: 'Moderator', banUser: 'Moderator', silentBanUser: 'Moderator',
            // Owner Controls
            clearChat: 'Owner', pauseChat: 'Owner', setSlowMode: 'Co-Owner',
            manageUsers: 'Co-Owner', viewAuditLog: 'Owner', viewPermissions: 'Owner', setPermissions: 'Owner'
        },
        ...db.data.chatData,
    };

    const ownerUsername = "Austin ;)";
    if (!db.data.users[ownerUsername]) {
        const salt = await bcrypt.genSalt(10);
        db.data.users[ownerUsername] = { passwordHash: await bcrypt.hash("AME", salt), nickname: "Austin ;)", icon: 'default', canCopy: true, hasAgreedToTerms: true, lastSeenRole: 'Owner' };
        db.data.chatData.roles[ownerUsername] = 'Owner';
    }
    // ... Heim Bot initialization
    await db.write();
    server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
}

// --- API Routes ---
app.get('/api/giphy-key', (req, res) => res.json({ apiKey: process.env.GIPHY_API_KEY }));
// ... login/join routes

io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('user-connect', async ({ username, role, nickname }) => {
        await db.read();
        currentUsername = username;
        const userData = db.data.users[username];
        activeUsers[username] = { socketId: socket.id, role, nickname, icon: userData?.icon, status: 'online' };
        
        socket.emit('join-successful', {
            allUsers: db.data.users, channels: db.data.chatData.channels, dms: db.data.chatData.dms,
            roles: db.data.chatData.roles, permissions: db.data.chatData.permissions,
            userRelations: db.data.chatData.userRelations[username] || { friends: [], blocked: [] },
            currentUserData: userData
        });

        io.emit('update-user-list', { activeUsers, allUsersData: db.data.users });
    });
    
    socket.on('accept-terms', async () => {
        if (currentUsername) {
            db.data.users[currentUsername].hasAgreedToTerms = true;
            await db.write();
        }
    });

    socket.on('tutorial-seen', async ({ role }) => {
        if (currentUsername) {
            db.data.users[currentUsername].lastSeenRole = role;
            await db.write();
        }
    });

    // ... all other socket handlers, now with permission checks, e.g.:
    socket.on('send-message', async ({ channel, message }) => {
        if (!hasPermission(currentUsername, 'sendMessage')) return;
        // ... rest of logic
    });
});

initializeServer();
