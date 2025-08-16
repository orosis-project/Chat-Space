// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MAIN_CHAT_CODE = "HMS";
const activeUsers = {}; 
const ROLES = ['Member', 'Moderator', 'Co-Owner', 'Owner'];

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(255) PRIMARY KEY,
                value BOOLEAN NOT NULL
            );
            INSERT INTO settings (key, value) VALUES ('auto_approve_users', FALSE) ON CONFLICT (key) DO NOTHING;
            INSERT INTO settings (key, value) VALUES ('redirect_new_users', FALSE) ON CONFLICT (key) DO NOTHING;

            CREATE TABLE IF NOT EXISTS users (
                username VARCHAR(255) PRIMARY KEY,
                password_hash VARCHAR(255) NOT NULL,
                nickname VARCHAR(255),
                icon TEXT,
                role VARCHAR(50) DEFAULT 'Member',
                status VARCHAR(50) DEFAULT 'pending'
            );
            CREATE TABLE IF NOT EXISTS security (
                username VARCHAR(255) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
                face_id_embedding TEXT,
                two_factor_secret VARCHAR(255),
                two_factor_enabled BOOLEAN DEFAULT FALSE,
                buddy_username VARCHAR(255)
            );
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                owner_username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
                fingerprint_id VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                UNIQUE(owner_username, fingerprint_id)
            );
            CREATE TABLE IF NOT EXISTS banned_devices (
                fingerprint_id VARCHAR(255) PRIMARY KEY,
                expiry_timestamp TIMESTAMPTZ
            );
            CREATE TABLE IF NOT EXISTS buddy_requests (
                from_username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
                to_username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
                PRIMARY KEY (from_username, to_username)
            );
            CREATE TABLE IF NOT EXISTS channels (
                name VARCHAR(255) PRIMARY KEY,
                is_private BOOLEAN DEFAULT FALSE,
                creator VARCHAR(255) REFERENCES users(username)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                channel_name VARCHAR(255) REFERENCES channels(name) ON DELETE CASCADE,
                author_username VARCHAR(255) REFERENCES users(username),
                content TEXT,
                type VARCHAR(50) DEFAULT 'text',
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        const ownerRes = await client.query("SELECT * FROM users WHERE username = 'Austin ;)'");
        if (ownerRes.rowCount === 0) {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash("AME", salt);
            await client.query(
                "INSERT INTO users (username, password_hash, nickname, icon, role, status) VALUES ($1, $2, $3, $4, $5, 'approved')",
                ['Austin ;)', passwordHash, 'Austin ;)', 'default', 'Owner']
            );
        }
    } finally {
        client.release();
    }
}

// --- API Routes ---
app.get('/api/hf-token', (req, res) => {
    if (process.env.HUGGING_FACE_TOKEN) res.json({ token: process.env.HUGGING_FACE_TOKEN });
    else res.status(500).json({ message: "Hugging Face token not configured." });
});

app.post('/join', (req, res) => {
    if (req.body.code === MAIN_CHAT_CODE) res.status(200).json({ message: "Access granted." });
    else res.status(401).json({ message: "Invalid Join Code." });
});

app.post('/login', async (req, res) => {
    const { username, password, fingerprintId } = req.body;
    try {
        const bannedDeviceRes = await pool.query("SELECT * FROM banned_devices WHERE fingerprint_id = $1 AND expiry_timestamp > NOW()", [fingerprintId]);
        if (bannedDeviceRes.rowCount > 0) {
            return res.status(403).json({ message: "This device has been temporarily banned." });
        }

        const userRes = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (userRes.rowCount > 0) {
            const user = userRes.rows[0];
            if (user.status === 'pending') return res.status(401).json({ message: "Account pending approval." });
            if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ message: "Invalid credentials." });
            res.status(200).json({ username: user.username, role: user.role, nickname: user.nickname, status: user.status });
        } else {
            const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'auto_approve_users'");
            const autoApprove = settingsRes.rows[0].value;
            const status = autoApprove ? 'approved' : 'pending';
            
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);
            const newUserRes = await pool.query(
                "INSERT INTO users (username, password_hash, nickname, icon, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [username, passwordHash, username, 'default', 'Member', status]
            );
            const newUser = newUserRes.rows[0];

            if (status === 'pending') {
                Object.values(activeUsers).forEach(user => {
                    if (ROLES.indexOf(user.role) >= ROLES.indexOf('Co-Owner')) {
                        io.to(user.socketId).emit('notification', { message: `New user request from ${username}`, type: 'info', event: 'new_user_request' });
                    }
                });
                return res.status(202).json({ message: "Account request sent. Waiting for approval." });
            }
            res.status(200).json({ username: newUser.username, role: newUser.role, nickname: newUser.nickname, status: newUser.status });
        }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Server error during login." });
    }
});

app.get('/users/pending', async (req, res) => {
    const pendingUsers = await pool.query("SELECT username FROM users WHERE status = 'pending'");
    res.json(pendingUsers.rows);
});

app.post('/users/:username/status', async (req, res) => {
    const { username } = req.params;
    const { action } = req.body;
    
    if (action === 'approve') {
        await pool.query("UPDATE users SET status = 'approved' WHERE username = $1", [username]);
    } else if (action === 'deny') {
        await pool.query("DELETE FROM users WHERE username = $1", [username]);
    }
    res.status(200).json({ message: `User ${action}d.` });
});

app.get('/security/:username', async (req, res) => {
    try {
        let securityRes = await pool.query("SELECT * FROM security WHERE username = $1", [req.params.username]);
        if (securityRes.rowCount === 0) {
            await pool.query("INSERT INTO security (username) VALUES ($1)", [req.params.username]);
            securityRes = await pool.query("SELECT * FROM security WHERE username = $1", [req.params.username]);
        }
        const devicesRes = await pool.query("SELECT * FROM devices WHERE owner_username = $1", [req.params.username]);
        const buddyReqRes = await pool.query("SELECT * FROM buddy_requests WHERE to_username = $1", [req.params.username]);
        const securityData = {
            ...securityRes.rows[0],
            devices: devicesRes.rows,
            buddyRequests: buddyReqRes.rows,
        };
        res.json(securityData);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch security data." });
    }
});

// --- Socket.IO ---
io.on('connection', async (socket) => {
    const { username } = socket.handshake.auth;
    if (!username) return socket.disconnect();
    
    const userRes = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (userRes.rowCount === 0) return socket.disconnect();
    const userData = userRes.rows[0];

    activeUsers[username] = { socketId: socket.id, role: userData.role, nickname: userData.nickname, icon: userData.icon, username };
    
    socket.emit('join-successful', {
        allUsers: (await pool.query("SELECT username, nickname, icon, role FROM users")).rows, 
        channels: (await pool.query("SELECT * FROM channels")).rows,
        username: userData.username, role: userData.role, nickname: userData.nickname,
    });
    io.emit('update-user-list', activeUsers);
    
    socket.on('disconnect', () => {
        delete activeUsers[username];
        io.emit('update-user-list', activeUsers);
    });
});

// --- Start Server ---
initializeDatabase().then(() => {
    server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));
}).catch(err => console.error("Failed to start server:", err));
