// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const cron = require('node-cron');

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
const messageTimestamps = {}; // { username: [timestamps] }
const cooldowns = {}; // { username: timeoutId }
const activeGames = {}; // { channel: { type, state } }

const inappropriateWords = [
    'badword1', 'profanity2', 'swear3', 'examplebadword', 'anotherexample'
];

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

// --- Bot Logic ---
const botSay = (channel, text) => {
    io.to(channel).emit('bot-message', { channel, text, icon: HEIM_BOT_ICON });
};

const handleBotCommand = (fullMessage, username, channel) => {
    const [commandWithPrefix, ...args] = fullMessage.split(' ');
    const command = commandWithPrefix.substring(1).toLowerCase(); // Remove '!'
    const userNickname = activeUsers[username]?.nickname || username;

    // A simple command registry for permission checks
    const commands = {
        'say': { minRank: 'Owner' }, 'saymain': { minRank: 'Owner' }, 'nickname': { minRank: 'Owner' },
        'exit': { minRank: 'Owner' }, 'minrank': { minRank: 'Owner' }, 'autoregular': { minRank: 'Owner' },
        'autoban': { minRank: 'Owner' }, 'typerace': { minRank: 'Moderator' }, 'numrace': { minRank: 'Moderator' },
        'trivia': { minRank: 'Moderator' }, 'end': { minRank: 'Moderator' }, 'urban': { minRank: 'Moderator' },
        // Visitor commands
        'define': { minRank: 'Member' }, 'weather': { minRank: 'Member' }, 'play': { minRank: 'Member' },
        'commands': { minRank: 'Member' }, '8ball': { minRank: 'Member' }, 'liedetector': { minRank: 'Member' },
        'better': { minRank: 'Member' }, 'choose': { minRank: 'Member' }, 'users': { minRank: 'Member' },
        'slap': { minRank: 'Member' }, 'lovetest': { minRank: 'Member' }, 'coinflip': { minRank: 'Member' },
        'dice': { minRank: 'Member' }, 'countdown': { minRank: 'Member' }, 'joke': { minRank: 'Member' }
    };

    if (commands[command] && !hasPermission(username, commands[command].minRank)) {
        return botSay(channel, `Sorry, ${userNickname}, you don't have permission to use the !${command} command.`);
    }

    switch (command) {
        // --- Fun Commands ---
        case '8ball':
            const responses = ["It is certain.", "Without a doubt.", "Yes, definitely.", "Ask again later.", "Cannot predict now.", "Don't count on it.", "My sources say no.", "Outlook not so good."];
            botSay(channel, `🎱 Magic 8-Ball says: "${responses[Math.floor(Math.random() * responses.length)]}"`);
            break;
        case 'slap':
            const target = args.join(' ');
            botSay(channel, `* ${userNickname} slaps ${target || 'the air'} around a bit with a large trout!`);
            break;
        case 'joke':
            const jokes = ["Why don't scientists trust atoms? Because they make up everything!", "I told my wife she should embrace her mistakes. She gave me a hug.", "What do you call a fake noodle? An Impasta."];
            botSay(channel, `😂 ${jokes[Math.floor(Math.random() * jokes.length)]}`);
            break;
        case 'coinflip':
            botSay(channel, `🪙 The coin flip result is: ${Math.random() > 0.5 ? 'Heads' : 'Tails'}`);
            break;
        case 'dice':
            const sides = parseInt(args[0], 10) || 6;
            const roll = Math.floor(Math.random() * sides) + 1;
            botSay(channel, `🎲 You rolled a ${sides}-sided die and got: ${roll}`);
            break;
        
        // --- Utility Commands ---
        case 'users':
            botSay(channel, `There are currently ${Object.keys(activeUsers).length} user(s) online.`);
            break;
        case 'weather':
            const location = args.join(' ') || 'your location';
            botSay(channel, `☀️ The weather in ${location} is currently sunny. (This is a demo, not real weather data)`);
            break;
        case 'define':
             const word = args.join(' ') || 'word';
             botSay(channel, `📖 Definition of ${word}: A sequence of letters with a specific meaning. (This is a demo, not a real dictionary)`);
             break;
        case 'commands':
            botSay(channel, "A full list of commands is available in the project's README file.");
            break;

        // --- Owner Commands ---
        case 'say':
            const msg = args.join(' ');
            if (msg) io.to(channel).emit('new-message', { channel, message: { nickname: 'Heim Bot', content: msg, timestamp: Date.now(), icon: HEIM_BOT_ICON }});
            break;

        // --- Default ---
        default:
            botSay(channel, `Unknown command: "!${command}". Type !commands for a list of available commands.`);
            break;
    }
};


// --- Initial Server Setup ---
async function initializeServer() {
    try {
        await db.read();
        db.data = db.data || { users: {}, chatData: {} };

        if (!db.data.chatData.channels) {
            db.data.chatData = {
                channels: { 'general': { messages: [], creator: 'System' } },
                dms: {},
                settings: { backgroundUrl: '' },
                roles: {},
                mutes: {},
                bans: [],
                flaggedMessages: [] // Initialize flagged messages log
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

        cron.schedule('0 * * * *', async () => {
            console.log('Running hourly cleanup for old messages...');
            await db.read();
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;
            Object.keys(db.data.chatData.channels).forEach(channelName => {
                const channel = db.data.chatData.channels[channelName];
                channel.messages = channel.messages.filter(msg => msg.pinned || (now - msg.timestamp < twentyFourHours));
            });
            await db.write();
            console.log('Cleanup complete.');
        });

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
    try {
        await db.read();
        const { username, password } = req.body;
        if (db.data.chatData.bans && db.data.chatData.bans.includes(username)) {
            return res.status(403).json({ message: "You are banned from this chat." });
        }
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
        res.status(200).json({ message: "Login successful.", username, role, nickname });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Server error during login." });
    }
});

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('user-connect', async ({ username, role, nickname }) => {
        await db.read();
        currentUsername = username;
        activeUsers[username] = { socketId: socket.id, role, nickname, icon: db.data.users[username]?.icon || 'default' };
        Object.keys(db.data.chatData.channels).forEach(channel => socket.join(channel));
        socket.emit('join-successful', {
            settings: db.data.chatData.settings,
            channels: db.data.chatData.channels,
            currentUser: { username, role, nickname, icon: activeUsers[username].icon },
            allUsers: db.data.users,
            roles: db.data.chatData.roles
        });
        io.emit('update-user-list', activeUsers);
        io.to('general').emit('system-message', { channel: 'general', text: `${nickname} has joined the chat.` });
    });
    
    socket.on('get-channel-history', (channelName) => {
        const channel = db.data.chatData.channels[channelName];
        if (channel) socket.emit('channel-history', { channel: channelName, messages: channel.messages });
    });

    socket.on('send-message', async (data) => {
        const { channel, message } = data;
        const sender = currentUsername;

        if (message.startsWith('!')) {
            handleBotCommand(message, sender, channel);
            return;
        }

        const now = Date.now();
        messageTimestamps[sender] = (messageTimestamps[sender] || []).filter(ts => now - ts < 5000);
        messageTimestamps[sender].push(now);
        if (messageTimestamps[sender].length > 5) {
            if (!cooldowns[sender]) {
                socket.emit('system-message', { channel, text: 'You are sending messages too quickly. Cooldown enabled for 5 seconds.' });
                cooldowns[sender] = setTimeout(() => { delete cooldowns[sender]; socket.emit('system-message', { channel, text: 'Cooldown finished.' }); }, 5000);
            }
            return;
        }

        const { cleanMessage, flagged } = filterMessage(message);
        if (flagged) {
            db.data.chatData.flaggedMessages.push({
                username: sender,
                nickname: activeUsers[sender].nickname,
                originalMessage: message,
                channel: channel,
                timestamp: now
            });
            await db.write();
            // Notify owner if they are online
            const owner = Object.values(activeUsers).find(u => u.role === 'Owner');
            if (owner) {
                io.to(owner.socketId).emit('new-flagged-message');
            }
        }

        const messageObject = { id: uuidv4(), author: sender, nickname: activeUsers[sender].nickname, content: cleanMessage, timestamp: now, role: activeUsers[sender].role, icon: activeUsers[sender].icon, pinned: false };
        db.data.chatData.channels[channel].messages.push(messageObject);
        await db.write();
        io.to(channel).emit('new-message', { channel, message: messageObject });
    });
    
    socket.on('get-flagged-messages', async () => {
        if (hasPermission(currentUsername, 'Owner')) {
            await db.read();
            socket.emit('flagged-messages-log', db.data.chatData.flaggedMessages);
        }
    });

    socket.on('create-channel', async ({ channelName }) => {
        if (hasPermission(currentUsername, 'Member')) {
            await db.read();
            if (!db.data.chatData.channels[channelName]) {
                db.data.chatData.channels[channelName] = { messages: [], creator: currentUsername };
                await db.write();
                io.emit('channels-updated', db.data.chatData.channels);
                io.sockets.sockets.forEach((sock) => sock.join(channelName));
            }
        }
    });
    
    socket.on('update-profile', async ({ nickname, icon }) => {
        await db.read();
        if(db.data.users[currentUsername]) {
            db.data.users[currentUsername].nickname = nickname;
            db.data.users[currentUsername].icon = icon;
            await db.write();
            activeUsers[currentUsername].nickname = nickname;
            activeUsers[currentUsername].icon = icon;
            io.emit('update-user-list', activeUsers);
            socket.emit('profile-updated', { nickname, icon });
        }
    });

    socket.on('admin-update-user', async ({ targetUser, nickname, icon, role }) => {
        if (hasPermission(currentUsername, 'Owner')) {
            await db.read();
            if (db.data.users[targetUser]) {
                db.data.users[targetUser].nickname = nickname;
                db.data.users[targetUser].icon = icon;
                db.data.chatData.roles[targetUser] = role;
                await db.write();
                if (activeUsers[targetUser]) {
                    activeUsers[targetUser].nickname = nickname;
                    activeUsers[targetUser].icon = icon;
                    activeUsers[targetUser].role = role;
                    const targetSocket = io.sockets.sockets.get(activeUsers[targetUser].socketId);
                    if (targetSocket) targetSocket.emit('force-update-profile', { nickname, icon, role });
                }
                io.emit('update-user-list', activeUsers);
            }
        }
    });

    socket.on('create-poll', ({ channel, question, options }) => {
        const poll = { id: uuidv4(), author: currentUsername, question, options: options.reduce((acc, opt) => ({...acc, [opt]: [] }), {}), timestamp: Date.now(), type: 'poll' };
        io.to(channel).emit('new-poll', { channel, poll });
    });
    
    socket.on('vote-poll', ({ channel, pollId, option }) => {
        io.to(channel).emit('poll-voted', { channel, pollId, option, voter: currentUsername });
    });

    socket.on('set-background', async ({ url }) => {
        if (hasPermission(currentUsername, 'Owner')) {
            db.data.chatData.settings.backgroundUrl = url;
            await db.write();
            io.emit('background-updated', url);
        }
    });

    socket.on('force-redirect', () => {
        if (hasPermission(currentUsername, 'Owner') || hasPermission(currentUsername, 'Co-Owner')) {
            io.emit('redirect-all', 'https://classroom.google.com/');
        }
    });

    socket.on('disconnect', () => {
        if (currentUsername && activeUsers[currentUsername]) {
            io.to('general').emit('system-message', { channel: 'general', text: `${activeUsers[currentUsername].nickname} has left the chat.` });
            delete activeUsers[currentUsername];
            io.emit('update-user-list', activeUsers);
        }
    });
});

initializeServer();
