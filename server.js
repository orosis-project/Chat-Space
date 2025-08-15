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

const canActOn = (actorUsername, targetUsername, rolesData) => {
    const actorRoleIndex = ROLES.indexOf(rolesData[actorUsername]);
    const targetRoleIndex = ROLES.indexOf(rolesData[targetUsername]);
    if (targetRoleIndex === -1) return true;
    return actorRoleIndex > targetRoleIndex;
};

const logAuditEvent = async (actor, action, details) => {
    db.data.chatData.auditLog.unshift({ timestamp: Date.now(), actor, action, details });
    if (db.data.chatData.auditLog.length > 200) db.data.chatData.auditLog.pop();
    await db.write();
};

async function initializeServer() {
    await db.read();
    db.data.users = db.data.users || {};
    db.data.chatData = db.data.chatData || {};

    // --- Self-Healing Database Structure ---
    // This block ensures that if the db.json is from an old version, it gets updated safely.
    const defaults = {
        channels: { 'general': { messages: [], private: false, creator: 'System', slowMode: 0 } },
        dms: {}, 
        userRelations: {}, 
        settings: { chatPaused: false }, 
        roles: {},
        bans: { normal: [], silent: [] }, 
        loggedMessages: {}, 
        auditLog: [], 
        mutes: {},
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
        if (!db.data.chatData[key]) {
            db.data.chatData[key] = defaults[key];
        }
    }
    // Ensure nested objects exist
    if (!db.data.chatData.bans.normal) db.data.chatData.bans.normal = [];
    if (!db.data.chatData.bans.silent) db.data.chatData.bans.silent = [];
    // --- End Self-Healing ---

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
}

// --- API Routes ---
app.get('/api/giphy-key', (req, res) => res.json({ apiKey: process.env.GIPHY_API_KEY }));
// ... login/join routes from v17 ...

io.on('connection', (socket) => {
    // All socket handlers from v17 are here...
});

initializeServer();
