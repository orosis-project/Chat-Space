{
  "name": "chat-space-final",
  "version": "1.0.0",
  "description": "A real-time chat application with advanced security",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "bcrypt": "^5.1.1",
    "express": "^4.19.2",
    "pg": "^8.11.3",
    "qrcode": "^1.5.3",
    "socket.io": "^4.7.5",
    "speakeasy": "^2.0.0",
    "uuid": "^9.0.1"
  }
}
```javascript:server.js
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

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

// --- Environment Variable Check ---
// Crucial check to ensure the application doesn't start without a database connection string.
// This prevents the 'getaddrinfo ENOTFOUND' error at runtime.
if (!process.env.DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1); // Exit the process with an error code
}

// --- Database Connection ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { 
        rejectUnauthorized: false // Required for connecting to services like Heroku Postgres or Render Postgres
    }
});

// --- Middleware ---
app.use(express.json({ limit: '5mb' })); // For parsing application/json, with a larger limit for things like face embeddings
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from the 'public' directory

// --- In-Memory State & Constants ---
const MAIN_CHAT_CODE = "HMS"; // Simple join code for initial access
const activeUsers = {}; 
const ROLES = ['Member', 'Moderator', 'Co-Owner', 'Owner'];

/**
 * Initializes the database by creating necessary tables if they don't exist.
 * Also creates a default 'Owner' user if one is not present.
 */
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Use a single transaction to create all tables
        await client.query('BEGIN');
        
        // Settings table for global app configuration
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
        
        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                username VARCHAR(255) PRIMARY KEY,
                password_hash VARCHAR(255) NOT NULL,
                nickname VARCHAR(255),
                icon TEXT,
                role VARCHAR(50) DEFAULT 'Member',
                status VARCHAR(50) DEFAULT 'pending'
            );
        `);
        
        // Security settings for each user
        await client.query(`
            CREATE TABLE IF NOT EXISTS security (
                username VARCHAR(255) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
                face_id_embedding TEXT,
                two_factor_secret VARCHAR(255),
                two_factor_enabled BOOLEAN DEFAULT FALSE,
                buddy_username VARCHAR(255)
            );
        `);
        
        // Recognized devices for users
        await client.query(`
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                owner_username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
                fingerprint_id VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                UNIQUE(owner_username, fingerprint_id)
            );
        `);
        
        // Banned device fingerprints
        await client.query(`
            CREATE TABLE IF NOT EXISTS banned_devices (
                fingerprint_id VARCHAR(255) PRIMARY KEY,
                expiry_timestamp TIMESTAMPTZ
            );
        `);
        
        // Buddy requests between users
        await client.query(`
            CREATE TABLE IF NOT EXISTS buddy_requests (
                from_username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
                to_username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
                PRIMARY KEY (from_username, to_username)
            );
        `);
        
        // Chat channels
        await client.query(`
            CREATE TABLE IF NOT EXISTS channels (
                name VARCHAR(255) PRIMARY KEY,
                is_private BOOLEAN DEFAULT FALSE,
                creator VARCHAR(255) REFERENCES users(username)
            );
        `);
        
        // Messages within channels
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                channel_name VARCHAR(255) REFERENCES channels(name) ON DELETE CASCADE,
                author_username VARCHAR(255) REFERENCES users(username),
                content TEXT,
                type VARCHAR(50) DEFAULT 'text',
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        // Insert default settings if they don't exist
        await client.query("INSERT INTO settings (key, value) VALUES ('auto_approve_users', 'false') ON CONFLICT (key) DO NOTHING;");
        await client.query("INSERT INTO settings (key, value) VALUES ('redirect_new_users', 'false') ON CONFLICT (key) DO NOTHING;");

        // Create the default owner account if it doesn't exist
        const ownerRes = await client.query("SELECT 1 FROM users WHERE role = 'Owner'");
        if (ownerRes.rowCount === 0) {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash("AME", salt); // Default password
            await client.query(
                "INSERT INTO users (username, password_hash, nickname, icon, role, status) VALUES ($1, $2, $3, $4, $5, 'approved')",
                ['Austin ;)', passwordHash, 'Austin ;)', 'default', 'Owner']
            );
        }
        
        await client.query('COMMIT');
        console.log("Database initialized successfully.");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error during database initialization:", err);
        throw err; // Re-throw the error to be caught by the server start logic
    } finally {
        client.release();
    }
}

// --- API Routes ---

// Provides the Hugging Face token to the client safely
app.get('/api/hf-token', (req, res) => {
    if (process.env.HUGGING_FACE_TOKEN) {
        res.json({ token: process.env.HUGGING_FACE_TOKEN });
    } else {
        res.status(500).json({ message: "Hugging Face token not configured on the server." });
    }
});

// Validates the initial join code
app.post('/join', (req, res) => {
    if (req.body.code === MAIN_CHAT_CODE) {
        res.status(200).json({ message: "Access granted." });
    } else {
        res.status(401).json({ message: "Invalid Join Code." });
    }
});

// Handles user login and registration requests
app.post('/login', async (req, res) => {
    const { username, password, fingerprintId } = req.body;
    if (!username || !password || !fingerprintId) {
        return res.status(400).json({ message: "Username, password, and fingerprint are required." });
    }

    try {
        // Check if the device is banned
        const bannedDeviceRes = await pool.query("SELECT * FROM banned_devices WHERE fingerprint_id = $1 AND expiry_timestamp > NOW()", [fingerprintId]);
        if (bannedDeviceRes.rowCount > 0) {
            return res.status(403).json({ message: "This device has been temporarily banned." });
        }

        const userRes = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        
        // --- Existing User Login ---
        if (userRes.rowCount > 0) {
            const user = userRes.rows[0];
            if (user.status === 'pending') {
                return res.status(401).json({ message: "Your account is still pending approval." });
            }
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({ message: "Invalid username or password." });
            }
            res.status(200).json({ username: user.username, role: user.role, nickname: user.nickname, status: user.status });
        
        // --- New User Registration ---
        } else {
            const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'auto_approve_users'");
            const autoApprove = settingsRes.rows[0]?.value === 'true';
            const status = autoApprove ? 'approved' : 'pending';
            
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);
            
            const newUserRes = await pool.query(
                "INSERT INTO users (username, password_hash, nickname, icon, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [username, passwordHash, username, 'default', 'Member', status]
            );
            const newUser = newUserRes.rows[0];

            if (status === 'pending') {
                // Notify admins/owners about the new request
                Object.values(activeUsers).forEach(user => {
                    if (ROLES.indexOf(user.role) >= ROLES.indexOf('Co-Owner')) {
                        io.to(user.socketId).emit('notification', { 
                            message: `New user request from ${username}`, 
                            type: 'info', 
                            event: 'new_user_request' 
                        });
                    }
                });
                return res.status(202).json({ message: "Account request sent. Waiting for approval." });
            }
            // If auto-approved, log them in directly
            res.status(200).json({ username: newUser.username, role: newUser.role, nickname: newUser.nickname, status: newUser.status });
        }
    } catch (error) {
        console.error("Login/Registration error:", error);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// Fetches a list of users with pending approval
app.get('/users/pending', async (req, res) => {
    try {
        const pendingUsers = await pool.query("SELECT username FROM users WHERE status = 'pending'");
        res.json(pendingUsers.rows);
    } catch (error) {
        console.error("Error fetching pending users:", error);
        res.status(500).json({ message: "Failed to fetch pending users." });
    }
});

// Approves or denies a pending user
app.post('/users/:username/status', async (req, res) => {
    const { username } = req.params;
    const { action } = req.body; // 'approve' or 'deny'
    
    try {
        if (action === 'approve') {
            await pool.query("UPDATE users SET status = 'approved' WHERE username = $1", [username]);
        } else if (action === 'deny') {
            await pool.query("DELETE FROM users WHERE username = $1", [username]);
        } else {
            return res.status(400).json({ message: "Invalid action." });
        }
        res.status(200).json({ message: `User ${username} has been ${action}d.` });
    } catch (error) {
        console.error(`Error ${action}ing user:`, error);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// Fetches security data for a specific user
app.get('/security/:username', async (req, res) => {
    try {
        const username = req.params.username;
        // Ensure security row exists
        await pool.query("INSERT INTO security (username) VALUES ($1) ON CONFLICT (username) DO NOTHING", [username]);
        
        const securityRes = await pool.query("SELECT * FROM security WHERE username = $1", [username]);
        const devicesRes = await pool.query("SELECT * FROM devices WHERE owner_username = $1", [username]);
        const buddyReqRes = await pool.query("SELECT * FROM buddy_requests WHERE to_username = $1", [username]);
        
        const securityData = {
            ...securityRes.rows[0],
            devices: devicesRes.rows,
            buddyRequests: buddyReqRes.rows,
        };
        res.json(securityData);
    } catch (error) {
        console.error("Error fetching security data:", error);
        res.status(500).json({ message: "Failed to fetch security data." });
    }
});

// --- Socket.IO Connection Handling ---
io.on('connection', async (socket) => {
    const { username } = socket.handshake.auth;
    if (!username) {
        console.log("Socket connection attempt without username.");
        return socket.disconnect();
    }
    
    try {
        const userRes = await pool.query("SELECT * FROM users WHERE username = $1 AND status = 'approved'", [username]);
        if (userRes.rowCount === 0) {
            console.log(`Disconnected unauthorized user: ${username}`);
            return socket.disconnect();
        }
        const userData = userRes.rows[0];

        // Store active user data
        activeUsers[username] = { 
            socketId: socket.id, 
            role: userData.role, 
            nickname: userData.nickname, 
            icon: userData.icon, 
            username 
        };
        
        // Send initial data to the newly connected client
        const allUsers = (await pool.query("SELECT username, nickname, icon, role FROM users WHERE status = 'approved'")).rows;
        const channels = (await pool.query("SELECT * FROM channels")).rows;
        
        socket.emit('join-successful', {
            allUsers, 
            channels,
            username: userData.username, 
            role: userData.role, 
            nickname: userData.nickname,
        });
        
        // Notify all clients of the updated user list
        io.emit('update-user-list', Object.values(activeUsers));
        
        // Handle disconnection
        socket.on('disconnect', () => {
            delete activeUsers[username];
            io.emit('update-user-list', Object.values(activeUsers));
            console.log(`User disconnected: ${username}`);
        });

    } catch (error) {
        console.error("Error during socket connection setup:", error);
        socket.disconnect();
    }
});

// --- Start Server ---
// We wrap the server start in an async IIFE (Immediately Invoked Function Expression)
// to use await for database initialization.
(async () => {
    try {
        await initializeDatabase();
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server is running on http://0.0.0.0:${PORT}`);
        });
    } catch (err) {
        console.error("Failed to start server due to database initialization failure:", err);
        process.exit(1);
    }
})();
```html:public/index.html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat Space</title>
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Remix Icons -->
    <link href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css" rel="stylesheet"/>
    <!-- Socket.IO Client -->
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
    <!-- Marked.js for Markdown parsing -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <!-- FingerprintJS for device identification -->
    <script>
      // Load FingerprintJS asynchronously
      const fpPromise = import('https://fpjscdn.net/v3/pwUaaQ43Ak0S6CjsUAsc')
        .then(FingerprintJS => FingerprintJS.load());
    </script>
    <!-- Custom Stylesheet -->
    <link rel="stylesheet" href="style.css">
</head>
<body class="bg-gray-100 dark:bg-black font-sans antialiased overflow-hidden">
    <div id="app-container" class="w-full h-screen relative flex items-center justify-center">
        <!-- Animated background -->
        <div id="chat-background" class="absolute inset-0 transition-all duration-500 bg-cover bg-center opacity-30" style="background-image: url('https://source.unsplash.com/random/1600x900?space,abstract');"></div>
        
        <!-- Page: Join Code -->
        <div id="join-code-page" class="page active z-10 flex flex-col items-center justify-center p-4">
             <div class="card text-center">
                <h1 class="text-4xl font-bold text-gray-800 dark:text-white mb-4">Chat Space</h1>
                <p class="text-gray-500 dark:text-gray-400 mb-6">Enter the join code to continue.</p>
                <div id="join-error" class="text-red-500 mb-4 h-5 font-semibold"></div>
                <form id="join-code-form" class="space-y-4">
                    <input type="text" id="join-code-input" placeholder="Join Code" class="input text-center tracking-widest font-bold text-lg" required>
                    <button type="submit" class="btn-primary w-full">Enter</button>
                </form>
            </div>
        </div>

        <!-- Page: Login / Register -->
        <div id="login-page" class="page hidden z-10 flex flex-col items-center justify-center p-4">
             <div class="card">
                <div class="text-center mb-8">
                    <h1 class="text-3xl font-bold text-gray-800 dark:text-white">Welcome Back</h1>
                    <p class="text-gray-500 dark:text-gray-400 mt-2">Sign in or request an account.</p>
                </div>
                <div id="login-error" class="text-red-500 text-center mb-4 h-5 font-semibold"></div>
                <form id="login-form" class="space-y-6">
                    <div class="relative"><i class="ri-user-line ri-lg absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i><input type="text" id="login-username" placeholder="Username" class="input pl-12" required></div>
                    <div class="relative"><i class="ri-lock-password-line ri-lg absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i><input type="password" id="login-password" placeholder="Password" class="input pl-12" required></div>
                    <button type="submit" class="btn-primary w-full">Login / Request Account</button>
                </form>
            </div>
        </div>
        
        <!-- Page: 2FA Verification -->
        <div id="two-factor-page" class="page hidden z-10 flex flex-col items-center justify-center p-4">
             <div class="card text-center">
                <h1 class="text-3xl font-bold text-gray-800 dark:text-white mb-2">Verification Required</h1>
                <p class="text-gray-500 dark:text-gray-400 mb-6">Enter the code from your authenticator app.</p>
                <div id="2fa-error" class="text-red-500 mb-4 h-5 font-semibold"></div>
                <form id="2fa-form">
                    <input type="text" id="2fa-code-input" placeholder="6-Digit Code" maxlength="6" class="input text-center tracking-[0.5em] font-bold text-2xl" required>
                    <button type="submit" class="btn-primary w-full mt-4">Verify</button>
                </form>
            </div>
        </div>

        <!-- Page: Main Chat Interface -->
        <div id="chat-page" class="page hidden w-full h-full z-10 flex">
            <!-- Left Sidebar: Channels & DMs -->
            <aside id="navigation-sidebar" class="sidebar">
                <div class="flex-shrink-0">
                    <div class="flex justify-between items-center mb-2">
                        <h2 class="sidebar-title">Branches</h2>
                        <button id="add-channel-btn" class="sidebar-icon-btn"><i class="ri-add-line"></i></button>
                    </div>
                    <div id="channels-list" class="space-y-1 overflow-y-auto max-h-48"></div>
                </div>
                <div class="flex-grow mt-4 pt-4 border-t border-gray-200/10 dark:border-gray-800/50 overflow-y-auto">
                     <h2 class="sidebar-title">Direct Messages</h2>
                     <div id="dm-list" class="space-y-1"></div>
                </div>
                <div class="mt-auto flex-shrink-0 space-y-2">
                    <button id="user-database-btn" class="sidebar-btn-full"><i class="ri-group-line"></i><span>Users</span></button>
                    <button id="settings-btn" class="sidebar-btn-full"><i class="ri-settings-3-line"></i><span>Settings</span></button>
                </div>
            </aside>
            <!-- Main Chat Area -->
            <main id="main-chat-area" class="flex-grow flex flex-col bg-white/5 dark:bg-gray-900/30 backdrop-blur-xl">
                <header class="header">
                    <div class="flex items-center gap-4">
                        <button id="menu-toggle-btn" class="sidebar-icon-btn md:hidden"><i class="ri-menu-line ri-lg"></i></button>
                        <h1 id="channel-title" class="text-xl font-bold dark:text-white"># general</h1>
                    </div>
                </header>
                <div id="chat-window" class="flex-grow p-4 overflow-y-auto"></div>
                <footer class="p-4 border-t border-gray-200/10 dark:border-gray-800/50 flex-shrink-0">
                    <div id="typing-indicator" class="h-5 text-sm italic text-gray-500 dark:text-gray-400"></div>
                    <form id="message-form" class="flex items-center gap-3">
                        <button type="button" id="giphy-btn" class="sidebar-icon-btn text-xl"><i class="ri-gif-line"></i></button>
                        <input type="text" id="message-input" placeholder="Type a message..." autocomplete="off" class="input flex-grow">
                        <button type="submit" class="btn-primary !p-3"><i class="ri-send-plane-2-fill ri-lg"></i></button>
                    </form>
                </footer>
            </main>
            <!-- Right Sidebar: Online Users -->
            <aside id="user-list-sidebar" class="sidebar">
                <h2 class="sidebar-title">Online Users</h2>
                <div id="user-list-container"></div>
            </aside>
        </div>
    </div>
    
    <!-- Root element for modals -->
    <div id="modal-root"></div>
    <!-- Container for toast notifications -->
    <div id="toast-container" class="fixed top-5 right-5 z-[100] space-y-3"></div>
    
    <!-- Main JavaScript file -->
    <script src="main.js"></script>
</body>
</html>
```css:public/style.css
@import url('[https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap](https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap)');

body {
    font-family: 'Inter', sans-serif;
}

/* --- Page Visibility --- */
.page.active {
    display: flex;
}
.page.hidden {
    display: none;
}

/* --- Core Components --- */
.card {
    @apply w-full max-w-sm bg-white/10 dark:bg-gray-900/50 backdrop-blur-2xl p-8 rounded-2xl shadow-2xl;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.input {
    @apply w-full px-4 py-3 bg-gray-100/50 dark:bg-gray-800/50 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300;
}

.btn-primary {
    @apply bg-blue-600 text-white font-bold py-3 px-5 rounded-lg hover:bg-blue-700 transition-all duration-300 shadow-lg shadow-blue-600/20;
}

.btn-secondary {
    @apply bg-gray-200/50 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 font-bold py-3 px-5 rounded-lg hover:bg-gray-300/70 dark:hover:bg-gray-600/70 transition-all duration-300;
}

.btn-danger {
    @apply bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700 transition-all duration-300 shadow-lg shadow-red-600/20 text-sm;
}

/* --- Layout: Sidebars & Header --- */
.sidebar {
    @apply w-64 bg-black/10 dark:bg-black/20 backdrop-blur-2xl p-4 flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-title {
    @apply text-lg font-bold dark:text-gray-200 px-3;
}

.sidebar-icon-btn {
    @apply p-2 rounded-lg transition-colors text-gray-400 hover:bg-white/10 dark:hover:bg-gray-800/60 hover:text-white;
}

.sidebar-btn-full {
    @apply flex items-center gap-3 w-full px-3 py-2.5 rounded-lg font-semibold text-sm text-gray-300 hover:bg-white/10 dark:hover:bg-gray-800/60 hover:text-white transition-colors;
}

.header {
    @apply p-3 border-b border-gray-200/10 dark:border-gray-800/50 flex items-center justify-between flex-shrink-0;
}

/* --- Responsive Sidebar --- */
@media (max-width: 767px) {
    .sidebar {
        @apply absolute top-0 left-0 h-full z-40 -translate-x-full;
    }
    #user-list-sidebar {
        @apply left-auto right-0 -translate-x-0 translate-x-full;
    }
    .sidebar.is-open {
        @apply translate-x-0;
    }
}

/* --- Modals --- */
.modal-container { 
    position: fixed; 
    inset: 0; 
    background-color: rgba(0,0,0,0.5); 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    z-index: 50; 
    backdrop-filter: blur(8px);
    animation: fadeIn 0.3s ease-out;
}
.modal-container.fade-out {
    animation: fadeOut 0.3s ease-in forwards;
}

.modal-content { 
    @apply bg-gray-100 dark:bg-gray-900 p-6 sm:p-8 rounded-2xl shadow-2xl;
    border: 1px solid rgba(255, 255, 255, 0.1);
    width: 90%; 
    max-width: 32rem; 
    animation: scaleIn 0.3s ease-out;
}
.modal-container.fade-out .modal-content {
    animation: scaleOut 0.3s ease-in forwards;
}

.modal-close-btn {
    @apply p-2 rounded-full transition-colors text-gray-400 hover:bg-white/10 dark:hover:bg-gray-800/60 hover:text-white;
}

/* --- Settings Tabs --- */
.setting-tab {
    @apply px-3 py-2 whitespace-nowrap font-semibold text-gray-500 dark:text-gray-400;
    border-bottom: 2px solid transparent;
}
.setting-tab.active {
    @apply text-blue-500 border-blue-500;
}
.setting-tab-content { display: none; }
.setting-tab-content.active { display: block; }

.modal-input {
    @apply w-full px-4 py-2 bg-gray-200/80 dark:bg-gray-800/80 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-300;
}

/* --- Toast Notifications --- */
.toast {
    @apply text-white font-semibold py-2 px-4 rounded-lg shadow-lg;
    animation: slideIn 0.5s ease-out forwards;
}
.toast-fade-out {
    animation: slideOut 0.5s ease-in forwards;
}

/* --- Animations --- */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes scaleOut { from { transform: scale(1); opacity: 1; } to { transform: scale(0.9); opacity: 0; } }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes slideOut { to { transform: translateX(120%); opacity: 0; } }
```javascript:public/main.js
// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', async () => {
    
    // --- Global State & Configuration ---
    if (typeof fpPromise === 'undefined') { 
        console.error("FingerprintJS not loaded! The application cannot run."); 
        return; 
    }
    
    let HUGGING_FACE_TOKEN = null;
    try {
        const response = await fetch('/api/hf-token');
        if (response.ok) {
            HUGGING_FACE_TOKEN = (await response.json()).token;
        } else {
            console.warn("Could not fetch Hugging Face token. Face ID features will be disabled.");
        }
    } catch (e) { 
        console.error("Error fetching Hugging Face token:", e); 
    }

    // Initialize Socket.IO client, but don't connect automatically
    const socket = io({ autoConnect: false });

    // Centralized application state
    let state = { 
        username: null, 
        role: null, 
        nickname: null, 
        icon: null, 
        currentChat: { type: 'channel', id: 'general' },
        allUsers: {}, 
        activeUsers: {}, 
        channels: {},
        securityData: { 
            devices: [], 
            buddy: null, 
            buddyRequests: [], 
            faceId: null, 
            twoFactorEnabled: false 
        },
        settings: { 
            auto_approve_users: false, 
            redirect_new_users: false 
        }
    };
    
    let tempLoginData = null; // Store login data temporarily during multi-step auth
    let currentVisitorId = null; // Device fingerprint
    let faceIdStream = null; // To hold the webcam stream

    // --- DOM Element Selectors ---
    const pages = { 
        joinCode: document.getElementById('join-code-page'), 
        login: document.getElementById('login-page'), 
        chat: document.getElementById('chat-page'), 
        twoFactor: document.getElementById('two-factor-page') 
    };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const twoFactorForm = document.getElementById('2fa-form');
    const settingsBtn = document.getElementById('settings-btn');
    const userDbBtn = document.getElementById('user-database-btn');
    const modalRoot = document.getElementById('modal-root');
    const toastContainer = document.getElementById('toast-container');
    
    // --- API & Core Helper Functions ---
    
    /**
     * A wrapper for the fetch API to handle JSON responses and errors.
     * @param {string} endpoint - The API endpoint to call.
     * @param {object} [options={}] - The options for the fetch call (method, body, etc.).
     * @returns {Promise<object>} - The JSON response from the server.
     */
    async function apiCall(endpoint, options = {}) {
        try {
            const response = await fetch(endpoint, options);
            const data = await response.json();
            if (!response.ok) {
                // Throw an error with the message from the server's JSON response
                throw new Error(data.message || `HTTP error! status: ${response.status}`);
            }
            return data;
        } catch (error) {
            console.error(`API call to ${endpoint} failed:`, error);
            showToast(error.message || 'A network error occurred.', 'error');
            throw error; // Re-throw the error to be caught by the calling function
        }
    }

    const api = {
        get: (endpoint) => apiCall(endpoint),
        post: (endpoint, body) => apiCall(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }),
    };

    /**
     * Handles communication with the Hugging Face API for face embeddings.
     */
    const huggingFaceApi = {
        async getEmbedding(blob) {
            if (!HUGGING_FACE_TOKEN) {
                throw new Error("Hugging Face token not available.");
            }
            const response = await fetch("https://api-inference.huggingface.co/models/facebook/dinov2-base", {
                headers: { Authorization: `Bearer ${HUGGING_FACE_TOKEN}` }, 
                method: "POST", 
                body: blob,
            });
            const result = await response.json();
            if (response.ok && Array.isArray(result) && result.length > 0 && result[0].blob) {
                return result[0].blob;
            }
            throw new Error(result.error || "Failed to get face embedding from Hugging Face.");
        }
    };

    /**
     * Calculates the cosine similarity between two vectors.
     * @param {number[]} vecA - The first vector.
     * @param {number[]} vecB - The second vector.
     * @returns {number} - The cosine similarity score (between -1 and 1).
     */
    const cosineSimilarity = (vecA, vecB) => {
        if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    };
    
    // --- UI Helper Functions ---

    /**
     * Displays a toast notification.
     * @param {string} message - The message to display.
     * @param {'info'|'success'|'error'} [type='info'] - The type of toast.
     */
    const showToast = (message, type = 'info') => {
        const colors = {
            info: 'bg-blue-500',
            success: 'bg-green-500',
            error: 'bg-red-500'
        };
        const toast = document.createElement('div');
        toast.className = `toast ${colors[type]}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    };

    /**
     * Opens a modal dialog.
     * @param {string} id - A unique ID for the modal.
     * @param {string} content - The HTML content for the modal.
     * @returns {HTMLElement} - The modal container element.
     */
    const openModal = (id, content) => {
        // Close any existing modal first
        document.getElementById(id)?.remove();

        const modalContainer = document.createElement('div');
        modalContainer.id = id;
        modalContainer.className = 'modal-container';
        modalContainer.innerHTML = `<div class="modal-content">${content}</div>`;
        modalRoot.appendChild(modalContainer);

        const closeModal = () => {
            modalContainer.classList.add('fade-out');
            modalContainer.addEventListener('animationend', () => modalContainer.remove());
        };

        // Attach close event listeners
        modalContainer.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
        modalContainer.addEventListener('click', (e) => { 
            if (e.target === modalContainer) closeModal(); 
        });
        
        return modalContainer;
    };
    
    /**
     * Switches the currently visible page.
     * @param {string} pageId - The ID of the page to show.
     */
    const switchPage = (pageId) => {
        Object.values(pages).forEach(page => page.classList.replace('active', 'hidden'));
        pages[pageId].classList.replace('hidden', 'active');
    };

    // --- Login & Authentication Flow ---

    const handleJoinAttempt = async (e) => {
        e.preventDefault();
        const joinError = document.getElementById('join-error');
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            await api.post('/join', { code });
            switchPage('login');
        } catch (error) {
            joinError.textContent = error.message;
        }
    };
    
    const handleLoginAttempt = async (e) => {
        e.preventDefault();
        const loginError = document.getElementById('login-error');
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            // Get the device fingerprint
            const fp = await fpPromise;
            const result = await fp.get();
            currentVisitorId = result.visitorId;

            // Attempt to log in or register
            const loginData = await api.post('/login', { username, password, fingerprintId: currentVisitorId });
            
            // Handle pending approval status
            if (loginData.message && loginData.message.includes("Waiting for approval")) {
                showToast(loginData.message, 'info');
                loginForm.reset();
                return;
            }

            tempLoginData = loginData;
            state.username = username;

            // Fetch security data for the user
            state.securityData = await api.get(`/security/${username}`);

            // Proceed to the next step in the auth flow
            if (state.securityData.two_factor_enabled) {
                switchPage('twoFactor');
                document.getElementById('2fa-code-input').focus();
            } else {
                await proceedWithPostPasswordAuth(loginData);
            }
        } catch (error) {
            loginError.textContent = error.message;
        }
    };

    const handle2faVerification = async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('2fa-error');
        errorEl.textContent = '';
        const code = document.getElementById('2fa-code-input').value;

        try {
            await api.post('/login/2fa', { username: state.username, token: code });
            await proceedWithPostPasswordAuth(tempLoginData);
        } catch (err) {
            errorEl.textContent = 'Invalid code. Please try again.';
        }
    };
    
    const proceedWithPostPasswordAuth = async (loginData) => {
        if (state.securityData.face_id_embedding) {
            // If Face ID is set up, verify it
            openFaceIdModal('verify', loginData);
        } else {
            // Check if the device is recognized
            const isDeviceRecognized = state.securityData.devices.some(d => d.fingerprint_id === currentVisitorId);
            if (isDeviceRecognized || state.securityData.devices.length === 0) {
                // If it's the first device, add it automatically
                if (state.securityData.devices.length === 0) {
                    await api.post(`/security/${state.username}/devices`, { id: currentVisitorId, name: 'Initial Device' });
                }
                connectToChat(loginData);
            } else {
                openUnrecognizedDeviceModal();
            }
        }
    };

    /**
     * Final step: connects to the Socket.IO server and transitions to the chat page.
     * @param {object} loginData - The successful login data from the server.
     */
    const connectToChat = (loginData) => {
        modalRoot.innerHTML = ''; // Clear any open modals
        switchPage('chat');
        // Set authentication data for the socket connection
        socket.auth = { username: loginData.username, role: loginData.role, nickname: loginData.nickname };
        socket.connect();
    };

    // --- Modal Implementations ---

    function openSettingsModal() {
        const content = `
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-2xl font-bold dark:text-white">Settings</h2>
                <button class="modal-close-btn"><i class="ri-close-line"></i></button>
            </div>
            <div class="mb-4 border-b border-gray-200/10 dark:border-gray-800/50">
                <nav class="flex space-x-1 sm:space-x-4 overflow-x-auto pb-2" aria-label="Tabs">
                    <button class="setting-tab active" data-tab="profile">Profile</button>
                    <button class="setting-tab" data-tab="security">Security</button>
                    ${(state.role === 'Owner' || state.role === 'Co-Owner') ? '<button class="setting-tab" data-tab="user-management">User Management</button>' : ''}
                </nav>
            </div>
            <div id="profile-tab-content" class="setting-tab-content active">...</div>
            <div id="security-tab-content" class="setting-tab-content hidden">...</div>
            ${(state.role === 'Owner' || state.role === 'Co-Owner') ? '<div id="user-management-tab-content" class="setting-tab-content hidden">...</div>' : ''}
        `;
        const modal = openModal('settings-modal', content);
        
        // Tab switching logic
        modal.querySelector('nav').addEventListener('click', (e) => {
            if (e.target.matches('.setting-tab')) {
                modal.querySelectorAll('.setting-tab').forEach(t => t.classList.remove('active'));
                modal.querySelectorAll('.setting-tab-content').forEach(c => c.classList.add('hidden'));
                e.target.classList.add('active');
                modal.querySelector(`#${e.target.dataset.tab}-tab-content`).classList.remove('hidden');
            }
        });

        // Render initial tab content
        renderProfileTab(modal.querySelector('#profile-tab-content'));
        renderSecurityTab(modal.querySelector('#security-tab-content'));
    }
    
    function renderProfileTab(container) { /* ... implementation ... */ }
    function renderSecurityTab(container) { /* ... implementation ... */ }
    
    async function openUserDbModal() {
        const content = `
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-2xl font-bold dark:text-white">User Database</h2>
                <button class="modal-close-btn"><i class="ri-close-line"></i></button>
            </div>
            <div id="pending-requests-section" class="mb-6"></div>
            <h3 class="text-lg font-bold dark:text-white mb-2">All Users</h3>
            <input type="text" id="user-db-search" placeholder="Search users..." class="modal-input mb-4">
            <div id="user-db-list" class="max-h-96 overflow-y-auto"></div>
        `;
        const modal = openModal('user-database-modal', content);
        await renderPendingRequests(modal.querySelector('#pending-requests-section'));
    }

    async function renderPendingRequests(container) {
        try {
            const requests = await api.get('/users/pending');
            if (requests.length === 0) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = `<h3 class="text-lg font-bold dark:text-white mb-2 text-yellow-400">Pending Requests</h3>`;
            requests.forEach(req => {
                const reqDiv = document.createElement('div');
                reqDiv.className = 'flex items-center justify-between p-2 rounded-lg bg-yellow-500/10 mb-2';
                reqDiv.innerHTML = `
                    <span class="font-semibold text-yellow-300">${req.username}</span>
                    <div>
                        <button class="approve-request-btn p-1 text-green-400 hover:bg-green-500/20 rounded-full" data-username="${req.username}"><i class="ri-check-line"></i></button>
                        <button class="deny-request-btn p-1 text-red-400 hover:bg-red-500/20 rounded-full" data-username="${req.username}"><i class="ri-close-line"></i></button>
                    </div>`;
                container.appendChild(reqDiv);
            });
            container.addEventListener('click', handleApprovalClick);
        } catch (err) {
            console.error("Failed to fetch pending requests:", err);
            container.innerHTML = `<p class="text-red-400">Could not load pending requests.</p>`;
        }
    }

    async function handleApprovalClick(e) {
        const approveBtn = e.target.closest('.approve-request-btn');
        const denyBtn = e.target.closest('.deny-request-btn');
        if (!approveBtn && !denyBtn) return;
        
        const username = approveBtn ? approveBtn.dataset.username : denyBtn.dataset.username;
        const action = approveBtn ? 'approve' : 'deny';

        try {
            await api.post(`/users/${username}/status`, { action });
            showToast(`User ${username} has been ${action}d.`, 'success');
            // Refresh the modal content
            openUserDbModal();
        } catch (err) {
            showToast(`Failed to ${action} user.`, 'error');
        }
    }
    
    function openFaceIdModal(mode, loginData = null) { /* ... implementation ... */ }
    function openUnrecognizedDeviceModal() { /* ... implementation ... */ }

    // --- Initial Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinAttempt);
    loginForm.addEventListener('submit', handleLoginAttempt);
    twoFactorForm.addEventListener('submit', handle2faVerification);
    settingsBtn.addEventListener('click', openSettingsModal);
    userDbBtn.addEventListener('click', openUserDbModal);

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server with socket ID:', socket.id);
    });

    socket.on('join-successful', (data) => {
        console.log('Successfully joined chat:', data);
        Object.assign(state, data); // Merge initial data into state
        switchPage('chat');
        // TODO: Render initial chat view (channels, users, etc.)
    });

    socket.on('update-user-list', (activeUsersList) => {
        console.log('Received updated user list:', activeUsersList);
        state.activeUsers = activeUsersList.reduce((acc, user) => {
            acc[user.username] = user;
            return acc;
        }, {});
        // TODO: Render the updated user list in the UI
    });

    socket.on('notification', (data) => {
        showToast(data.message, data.type || 'info');
        // If an admin is viewing the user DB, refresh it on new user request
        if (data.event === 'new_user_request' && document.getElementById('user-database-modal')) {
            openUserDbModal();
        }
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        showToast('You have been disconnected.', 'error');
        // TODO: Handle reconnection logic or redirect to login
    });
});
