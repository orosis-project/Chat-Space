// server.js
// Production-ready backend for Chat Space

// --- Dependencies ---
const express = require('express');
const http =require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const saltRounds = 10;

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const JOIN_CODE = 'HMS';

// --- File Upload Setup ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// --- Database Connection ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- Middleware ---
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'a-very-secret-key-for-local-dev',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// --- Database Schema Setup ---
const setupDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'User', icon_url TEXT DEFAULT '/assets/default-icon.png', status VARCHAR(20) DEFAULT 'active', settings JSONB DEFAULT '{}');`);
        await client.query(`CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR(50) PRIMARY KEY, value TEXT);`);
        const ownerCheck = await client.query('SELECT * FROM users WHERE role = $1', ['Owner']);
        if (ownerCheck.rows.length === 0) {
            const ownerPassword = await bcrypt.hash('AME', saltRounds);
            await client.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', ['Austin ;)', ownerPassword, 'Owner']);
        }
        await client.query(`INSERT INTO app_settings (key, value) VALUES ('require_account_approval', 'true') ON CONFLICT (key) DO NOTHING;`);
        await client.query(`INSERT INTO app_settings (key, value) VALUES ('chat_background', '/assets/default-bg.jpg') ON CONFLICT (key) DO NOTHING;`);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error setting up database:', err);
    } finally {
        client.release();
    }
};

// --- Global State ---
let onlineUsers = {}; // { userId: { id, username, role, icon_url, socketId } }
let appSettings = {};

const loadAppSettings = async () => {
    const result = await pool.query('SELECT key, value FROM app_settings');
    result.rows.forEach(row => {
        appSettings[row.key] = row.value;
    });
    console.log("App settings loaded:", appSettings);
};

// --- Security Middleware & Helpers ---
const isOwner = async (req, res, next) => {
    if (!req.session.userId) return res.status(403).json({ success: false, message: 'Forbidden' });
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.session.userId]);
    if (userResult.rows.length > 0 && userResult.rows[0].role === 'Owner') next();
    else res.status(403).json({ success: false, message: 'Forbidden' });
};

// --- API Routes ---
app.get('/api/settings', async (req, res) => {
    res.json({
        requireAccountApproval: appSettings.require_account_approval === 'true',
        chatBackground: appSettings.chat_background
    });
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const status = appSettings.require_account_approval === 'true' ? 'pending' : 'active';
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, status) VALUES ($1, $2, $3) RETURNING id',
            [username, hashedPassword, status]
        );
        req.session.pendingUserId = result.rows[0].id;
        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Username already exists.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    if (user.status === 'pending') return res.status(403).json({ success: false, status: 'pending' });
    if (user.status === 'denied') return res.status(403).json({ success: false, message: 'Your account has been denied.' });

    req.session.userId = user.id;
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, icon_url: user.icon_url } });
});

app.post('/api/upload/icon', upload.single('icon'), async (req, res) => {
    if (!req.session.userId || !req.file) return res.status(400).json({ success: false });
    const iconUrl = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE users SET icon_url = $1 WHERE id = $2', [iconUrl, req.session.userId]);
    res.json({ success: true, iconUrl });
});

app.post('/api/owner/background', isOwner, upload.single('background'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    const bgUrl = `/uploads/${req.file.filename}`;
    await pool.query(`UPDATE app_settings SET value = $1 WHERE key = 'chat_background'`, [bgUrl]);
    appSettings.chat_background = bgUrl;
    io.emit('background_changed', bgUrl);
    res.json({ success: true, bgUrl });
});

app.get('/api/owner/users', isOwner, async (req, res) => {
    const result = await pool.query('SELECT id, username, role, status, icon_url FROM users');
    res.json({ success: true, users: result.rows });
});

app.post('/api/owner/user/:id', isOwner, async (req, res) => {
    const { id } = req.params;
    const { username, status } = req.body;
    await pool.query('UPDATE users SET username = $1, status = $2 WHERE id = $3', [username, status, id]);
    
    const targetSocket = Object.values(onlineUsers).find(u => u.id == id);
    if (targetSocket) {
        if (status === 'active' || status === 'denied') {
            io.to(targetSocket.socketId).emit('account_status_update', { status });
        }
    }
    res.json({ success: true });
});

// --- Socket.IO Connection Handling ---
io.on('connection', async (socket) => {
    let session = socket.request.session;
    let userId;

    if (session.userId) {
        userId = session.userId;
    } else if (session.pendingUserId) {
        userId = session.pendingUserId;
    } else {
        socket.disconnect();
        return;
    }
    
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) { socket.disconnect(); return; }
    
    const user = userResult.rows[0];
    onlineUsers[userId] = { ...user, socketId: socket.id };

    if (user.status === 'active') {
        io.emit('update_user_list', Object.values(onlineUsers).filter(u => u.status === 'active'));
        socket.broadcast.emit('system_message', `${user.username} has joined.`);
    }

    socket.on('chat_message', (msg) => {
        const sender = onlineUsers[userId];
        if (sender && sender.status === 'active') {
            io.emit('chat_message', { user: sender.username, role: sender.role, icon_url: sender.icon_url, text: msg });
        }
    });

    socket.on('disconnect', () => {
        const disconnectedUser = onlineUsers[userId];
        delete onlineUsers[userId];
        if (disconnectedUser && disconnectedUser.status === 'active') {
            io.emit('update_user_list', Object.values(onlineUsers).filter(u => u.status === 'active'));
            io.emit('system_message', `${disconnectedUser.username} has left.`);
        }
    });
});

// --- Server Start ---
server.listen(PORT, async () => {
    await setupDatabase();
    await loadAppSettings();
    console.log(`Server running on http://localhost:${PORT}`);
});
