// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL is not set.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Initialization ---
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            username VARCHAR(255) PRIMARY KEY, password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'Member', status VARCHAR(50) DEFAULT 'approved'
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(255) PRIMARY KEY, value BOOLEAN DEFAULT TRUE
        )`);
        await client.query("INSERT INTO settings (key, value) VALUES ('require_account_approval', TRUE) ON CONFLICT (key) DO NOTHING");
        
        const ownerRes = await client.query("SELECT 1 FROM users WHERE username = 'Owner'");
        if (ownerRes.rowCount === 0) {
            const hash = await bcrypt.hash("defaultpass", 10);
            await client.query("INSERT INTO users (username, password_hash, role, status) VALUES ($1, $2, 'Owner', 'approved')", ['Owner', hash]);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK'); throw e;
    } finally {
        client.release();
    }
}

// --- API Routes ---

// NEW: Endpoint to provide auth settings to the frontend
app.get('/api/auth-info', async (req, res) => {
    try {
        const settingRes = await pool.query("SELECT value FROM settings WHERE key = 'require_account_approval'");
        const approvalRequired = settingRes.rows[0]?.value || false;
        res.json({ approvalRequired });
    } catch (e) {
        res.status(500).json({ message: "Server error." });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const settingRes = await pool.query("SELECT value FROM settings WHERE key = 'require_account_approval'");
        const approvalRequired = settingRes.rows[0]?.value;
        const status = approvalRequired ? 'pending' : 'approved';

        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (username, password_hash, status) VALUES ($1, $2, $3)", [username, hash, status]);
        
        if (status === 'pending') {
            io.emit('admin-notification', { type: 'new_user_request', username });
        }
        res.status(201).json({ success: true, status });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: "Username already exists." });
        res.status(500).json({ message: "Server error." });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userRes = await pool.query("SELECT username, role, status, password_hash FROM users WHERE username = $1", [username]);
        if (userRes.rowCount === 0) return res.status(401).json({ message: "Invalid credentials." });
        
        const user = userRes.rows[0];
        if (user.status !== 'approved') return res.status(403).json({ message: `Your account is currently ${user.status}.` });

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ message: "Invalid credentials." });
        
        delete user.password_hash;
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ message: "Server error." });
    }
});

// Owner-only routes for approval/denial remain the same...
app.post('/api/owner/approve', async (req, res) => {
    const { username } = req.body;
    await pool.query("UPDATE users SET status = 'approved' WHERE username = $1", [username]);
    io.to(username).emit('account-approved', { message: "Your account has been approved! You can now log in." });
    res.sendStatus(200);
});
app.post('/api/owner/deny', async (req, res) => {
    const { username } = req.body;
    await pool.query("DELETE FROM users WHERE username = $1", [username]);
    io.to(username).emit('account-denied', { message: "Your account request has been denied." });
    res.sendStatus(200);
});

// --- Socket.IO ---
io.on('connection', (socket) => {
    socket.on('join-pending-room', (username) => {
        socket.join(username);
    });
});

// --- Server Start ---
(async () => {
    try {
        await initializeDatabase();
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (e) {
        console.error("Failed to start server.", e);
        process.exit(1);
    }
})();
