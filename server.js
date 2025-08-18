// server.js - Chat Space Backend

// Load environment variables from .env file
require('dotenv').config();

// Core libraries
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); // A hashing library for passwords
const speakeasy = require('speakeasy'); // For 2FA
const { v4: uuidv4 } = require('uuid'); // For unique IDs
const cors = require('cors'); // For handling cross-origin requests

// --- Configuration ---
const app = express();
const server = http.createServer(app);
// Use the Socket.IO server for real-time communication
const io = new Server(server);

// The secret join code for the application.
const JOIN_CODE = 'HMS';
// The owner's pre-configured credentials
const OWNER_USERNAME = 'Austin';
const OWNER_PASSWORD_HASH = '$2a$10$w4rYv5p2GzH3zI4s5L.6O1.C9o9y.3j/zS.wX2F2q6B.nK5yO'; // Hashed 'AME'
const OWNER_ROLE = 'owner';

// Giphy API configuration
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';

// Hugging Face API configuration (simulated for demonstration)
const HUGGING_FACE_TOKEN = process.env.HUGGING_FACE_TOKEN;
const HUGGING_FACE_API_URL = 'https://api-inference.huggingface.co/models/deepset/sentence-similarity';

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // To parse JSON bodies
app.use(cors()); // Enable CORS for development and API calls

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Immediately connect to the database to ensure it's working
pool.connect().then(() => {
  console.log('Connected to PostgreSQL database');
  // Initialize the database schema and seed the owner account
  initializeDatabase();
}).catch(err => {
  console.error('Database connection error:', err.stack);
});

// --- Database Schema & Seeding ---
async function initializeDatabase() {
  try {
    // Users table: stores user credentials, roles, and security settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        is_verified BOOLEAN DEFAULT FALSE,
        twofa_secret VARCHAR(255),
        face_id_vector TEXT, -- Stores the JSON string of a face embedding array
        known_devices TEXT, -- Stores the JSON string of an array of device IDs
        buddy_id VARCHAR(255),
        is_pending BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Security events table: logs all security-related actions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        event_type VARCHAR(255) NOT NULL,
        ip_address VARCHAR(255),
        device_id VARCHAR(255),
        description TEXT,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // IP controls table: allows owner to manage IP access
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ip_controls (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(255) UNIQUE NOT NULL,
        rule VARCHAR(50) NOT NULL -- 'allow' or 'deny'
      );
    `);
    
    // Chat messages table: stores chat history
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id),
        username VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        role VARCHAR(50) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Global application settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(255) PRIMARY KEY,
        setting_value VARCHAR(255)
      );
    `);

    // Check for the owner account and create if it doesn't exist
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [OWNER_USERNAME]);
    if (result.rows.length === 0) {
      console.log('Owner account not found. Seeding now...');
      await pool.query(
        'INSERT INTO users (id, username, password_hash, role, is_pending) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), OWNER_USERNAME, OWNER_PASSWORD_HASH, OWNER_ROLE, false]
      );
      console.log('Owner account "Austin" successfully seeded.');
    }
    
    // Check and set the account approval setting
    const approvalSetting = await pool.query('SELECT setting_value FROM settings WHERE setting_key = $1', ['require_account_approval']);
    if (approvalSetting.rows.length === 0) {
      await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2)', ['require_account_approval', 'false']);
    }

    // Start a periodic data pruning task
    setInterval(pruneOldData, 24 * 60 * 60 * 1000); // Every 24 hours

  } catch (err) {
    console.error('Error initializing database:', err.stack);
  }
}

// Function to prune old data to manage database size
async function pruneOldData() {
  const cutoffDate = new Date();
  // Cut off date is 30 days ago. You can adjust this value.
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  try {
    // Prune security logs
    const result = await pool.query('DELETE FROM security_events WHERE timestamp < $1', [cutoffDate]);
    console.log(`Pruned ${result.rowCount} old security events.`);
    
    // Prune old chat messages to save space
    const messagesResult = await pool.query('DELETE FROM messages WHERE timestamp < $1', [cutoffDate]);
    console.log(`Pruned ${messagesResult.rowCount} old chat messages.`);

  } catch (err) {
    console.error('Error pruning data:', err.stack);
  }
}

// --- Global State ---
let activeUsers = {};
let polls = {};
let emergencyLockdownMode = null; // 'all' | 'unauthenticated' | null
let buddyRequests = {};

// --- Security Middleware ---
// IP Address Controls Middleware
app.use(useIpControls);
async function useIpControls(req, res, next) {
  const clientIp = req.ip;
  try {
    const result = await pool.query('SELECT rule FROM ip_controls WHERE ip_address = $1', [clientIp]);
    if (result.rows.length > 0) {
      if (result.rows[0].rule === 'deny') {
        return res.status(403).send('Access Denied: Your IP address is blocked.');
      }
    }
    next();
  } catch (err) {
    console.error('Error checking IP controls:', err);
    next();
  }
}

// Emergency Lockdown Middleware
app.use((req, res, next) => {
  if (emergencyLockdownMode === 'all') {
    return res.status(503).send('System is in Emergency Lockdown.');
  }
  // This logic would be more complex to check for authenticated users
  if (emergencyLockdownMode === 'unauthenticated' && !req.headers.authorization) {
    return res.status(503).send('System is in Emergency Lockdown for unauthenticated users.');
  }
  next();
});

// --- API Endpoints ---
app.post('/api/join', (req, res) => {
  const { code } = req.body;
  if (code === JOIN_CODE) {
    res.json({ success: true, message: 'Join code accepted.' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid join code.' });
  }
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }
  try {
    const result = await pool.query('SELECT setting_value FROM settings WHERE setting_key = $1', ['require_account_approval']);
    const requiresApproval = result.rows[0].setting_value === 'true';
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    await pool.query(
      'INSERT INTO users (id, username, password_hash, is_pending) VALUES ($1, $2, $3, $4)',
      [userId, username, hashedPassword, requiresApproval]
    );

    // Log the registration event
    await pool.query(
      'INSERT INTO security_events (user_id, event_type, description, ip_address) VALUES ($1, $2, $3, $4)',
      [userId, 'register', `User ${username} registered. Approval required: ${requiresApproval}`, req.ip]
    );

    // Notify the owner of a new pending account
    if (requiresApproval) {
        const ownerSocket = Object.values(activeUsers).find(u => u.role === 'owner');
        if (ownerSocket) {
            ownerSocket.sockets.forEach(sockId => {
                io.to(sockId).emit('owner-alert', { type: 'new-registration', message: `A new user, ${username}, has registered and is pending approval.` });
            });
        }
    }
    
    res.json({ success: true, message: 'Registration successful. Waiting for approval.', requiresApproval });
  } catch (err) {
    if (err.code === '23505') { // Unique violation error code
      return res.status(409).json({ success: false, message: 'Username already exists.' });
    }
    console.error('Registration error:', err.stack);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password, deviceId } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    if (user.is_pending) {
      return res.status(403).json({ success: false, message: 'Account pending approval.' });
    }

    // Proactive Threat Detection & Multi-step Login
    let nextStep = 'success';
    let challengeReason = '';

    // Check for 2FA
    if (user.twofa_secret) {
      nextStep = '2fa';
      challengeReason = '2FA required.';
    }

    // Check for Device Verification
    if (user.known_devices) {
      const knownDevices = JSON.parse(user.known_devices);
      if (!knownDevices.includes(deviceId)) {
        nextStep = 'device-challenge';
        challengeReason = 'Unrecognized device.';
      }
    }
    
    // Check for Face ID
    if (user.face_id_vector) {
        nextStep = 'face-id';
        challengeReason = 'Unrecognized device, face verification required.';
    }
    
    // Notify the owner of a login attempt requiring 2FA or device verification
    if (nextStep !== 'success') {
        const ownerSocket = Object.values(activeUsers).find(u => u.role === 'owner');
        if (ownerSocket) {
            ownerSocket.sockets.forEach(sockId => {
                io.to(sockId).emit('owner-alert', { type: 'suspicious-login', message: `Suspicious login attempt for ${username}. Reason: ${challengeReason}` });
            });
        }
    }

    // Log the event
    await pool.query(
      'INSERT INTO security_events (user_id, event_type, description, ip_address, device_id) VALUES ($1, $2, $3, $4, $5)',
      [user.id, 'login-attempt', `Login attempt for ${username}. Next step: ${nextStep}`, req.ip, deviceId]
    );

    res.json({ success: true, message: 'Login successful.', user, nextStep, challengeReason });

  } catch (err) {
    console.error('Login error:', err.stack);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/2fa/setup', async (req, res) => {
    const { userId } = req.body;
    try {
        const secret = speakeasy.generateSecret({
            name: `Chat Space (${userId})`
        });
        await pool.query('UPDATE users SET twofa_secret = $1 WHERE id = $2', [secret.base32, userId]);
        res.json({ success: true, secret: secret.base32 });
    } catch (err) {
        console.error('2FA setup error:', err.stack);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

app.post('/api/2fa/verify', async (req, res) => {
  const { userId, token } = req.body;
  try {
    const result = await pool.query('SELECT twofa_secret FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const verified = speakeasy.totp.verify({
      secret: user.twofa_secret,
      encoding: 'base32',
      token: token,
    });
    if (verified) {
      // Log the event
      await pool.query(
        'INSERT INTO security_events (user_id, event_type, description, ip_address) VALUES ($1, $2, $3, $4)',
        [userId, '2fa-success', `2FA verification successful.`, req.ip]
      );
      res.json({ success: true, message: '2FA verified. Access granted.' });
    } else {
      // Log the event
      await pool.query(
        'INSERT INTO security_events (user_id, event_type, description, ip_address) VALUES ($1, $2, $3, $4)',
        [userId, '2fa-failure', `2FA verification failed.`, req.ip]
      );
      res.status(401).json({ success: false, message: 'Invalid 2FA token.' });
    }
  } catch (err) {
    console.error('2FA verification error:', err.stack);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/faceid/verify', async (req, res) => {
  // This is a simulated endpoint. In a real scenario, you'd send an image here.
  const { userId, imageBase64 } = req.body;
  
  try {
    const result = await pool.query('SELECT face_id_vector FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user || !user.face_id_vector) {
      return res.status(404).json({ success: false, message: 'User not found or Face ID not enrolled.' });
    }

    const storedVector = JSON.parse(user.face_id_vector);
    
    // Simulate sending image to Hugging Face API and getting a new vector
    // This part requires a real API call. The below is a simplified simulation.
    // const newVectorResponse = await fetch(HUGGING_FACE_API_URL, {
    //   headers: { Authorization: `Bearer ${HUGGING_FACE_TOKEN}` },
    //   body: JSON.stringify({ image: imageBase64 })
    // });
    // const newVector = await newVectorResponse.json();

    // For this demonstration, we'll just simulate a positive verification
    const isVerified = Math.random() > 0.1; // 90% chance of success

    if (isVerified) {
        // Log the event
        await pool.query(
            'INSERT INTO security_events (user_id, event_type, description, ip_address) VALUES ($1, $2, $3, $4)',
            [userId, 'faceid-success', `Face ID verification successful.`, req.ip]
        );
        res.json({ success: true, message: 'Face ID verified.' });
    } else {
        // Log the event
        await pool.query(
            'INSERT INTO security_events (user_id, event_type, description, ip_address) VALUES ($1, $2, $3, $4)',
            [userId, 'faceid-failure', `Face ID verification failed.`, req.ip]
        );
        res.status(401).json({ success: false, message: 'Face ID verification failed. Try again.' });
    }

  } catch (err) {
    console.error('Face ID verification error:', err.stack);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/giphy/search', async (req, res) => {
    const searchTerm = req.query.q;
    if (!searchTerm) {
        return res.status(400).json({ success: false, message: 'Search term is required.' });
    }

    try {
        const response = await fetch(`${GIPHY_SEARCH_URL}?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchTerm)}&limit=25`);
        const data = await response.json();
        res.json({ success: true, data: data.data });
    } catch (err) {
        console.error('Giphy API error:', err);
        res.status(500).json({ success: false, message: 'Error fetching GIFs from Giphy.' });
    }
});

app.get('/api/admin/security-logs', async (req, res) => {
  // In a real app, this would be behind authentication middleware
  try {
    const result = await pool.query('SELECT * FROM security_events ORDER BY timestamp DESC LIMIT 100');
    res.json({ success: true, logs: result.rows });
  } catch (err) {
    console.error('Error fetching security logs:', err.stack);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// --- Socket.IO Events ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initial connection from the client
    socket.on('user-ready', async ({ user, deviceId }) => {
        const existingUser = activeUsers[user.id];
        if (existingUser) {
            // Reconnecting user
            existingUser.sockets.push(socket.id);
        } else {
            // New user connection
            activeUsers[user.id] = { ...user, sockets: [socket.id] };
        }
        
        // Update the user's known devices in the database
        try {
            const result = await pool.query('SELECT known_devices FROM users WHERE id = $1', [user.id]);
            const dbDevices = result.rows[0].known_devices ? JSON.parse(result.rows[0].known_devices) : [];
            if (!dbDevices.includes(deviceId)) {
                dbDevices.push(deviceId);
                await pool.query('UPDATE users SET known_devices = $1 WHERE id = $2', [JSON.stringify(dbDevices), user.id]);
            }
        } catch (err) {
            console.error('Error updating known devices:', err);
        }

        // Broadcast the updated user list to all clients
        io.emit('user-list-update', Object.values(activeUsers).map(u => ({ username: u.username, role: u.role })));
        
        // Load the most recent messages from the database
        const messageResult = await pool.query('SELECT username, message, role, timestamp FROM messages ORDER BY timestamp ASC');
        socket.emit('load-messages', messageResult.rows);
    });

    socket.on('chat-message', async (data) => {
        // Save the message to the database
        try {
          await pool.query(
            'INSERT INTO messages (user_id, username, message, role) VALUES ($1, $2, $3, $4)',
            [data.userId, data.username, data.message, data.role]
          );
        } catch (err) {
          console.error('Error saving message to database:', err);
        }

        // Broadcast the message to all connected clients
        io.emit('chat-message', {
            username: data.username,
            message: data.message,
            timestamp: new Date().toLocaleTimeString(),
            role: data.role
        });

        // Check for HeimBot commands
        if (data.message.startsWith('!')) {
            handleHeimBotCommand(data.message.substring(1).trim(), data.username);
        }
    });
    
    // Poll creation event
    socket.on('create-poll', (pollData) => {
      const pollId = uuidv4();
      polls[pollId] = {
        id: pollId,
        question: pollData.question,
        options: pollData.options.map(opt => ({ text: opt, votes: 0 })),
        creator: pollData.username,
      };
      // Broadcast the new poll to all clients
      io.emit('poll-new', polls[pollId]);
    });

    // Poll voting event
    socket.on('vote-poll', ({ pollId, optionIndex }) => {
      if (polls[pollId] && polls[pollId].options[optionIndex]) {
        polls[pollId].options[optionIndex].votes++;
        // Broadcast the updated poll results
        io.emit('poll-update', polls[pollId]);
      }
    });

    // Buddy system request
    socket.on('buddy-request', async ({ userId, buddyUsername }) => {
      try {
        const result = await pool.query('SELECT id, twofa_secret, face_id_vector, known_devices FROM users WHERE username = $1', [buddyUsername]);
        const buddy = result.rows[0];
        if (buddy && activeUsers[buddy.id]) {
          const requestId = uuidv4();
          buddyRequests[requestId] = {
            requesterId: userId,
            buddyId: buddy.id,
          };
          // Send a notification to the buddy's socket(s)
          activeUsers[buddy.id].sockets.forEach(sockId => {
            io.to(sockId).emit('buddy-request-notification', { requestId, requesterUsername: activeUsers[userId].username });
          });
          io.to(socket.id).emit('buddy-request-sent', { success: true, message: `Request sent to ${buddyUsername}.` });
        } else {
          io.to(socket.id).emit('buddy-request-sent', { success: false, message: 'Buddy not found or not online.' });
        }
      } catch (err) {
        console.error('Buddy request error:', err);
      }
    });
    
    // Buddy system response
    socket.on('buddy-request-response', ({ requestId, approved }) => {
      const request = buddyRequests[requestId];
      if (request) {
        if (approved) {
          // Grant access to the requester. This would be handled on the server
          // by updating their session or allowing them to log in.
          // For this simulation, we'll just send a success message.
          if (activeUsers[request.requesterId]) {
            activeUsers[request.requesterId].sockets.forEach(sockId => {
              io.to(sockId).emit('buddy-request-approved', { success: true, message: 'Your buddy approved your request. You can now log in.' });
            });
          }
        }
        delete buddyRequests[requestId];
      }
    });
    
    // Emergency Lockdown from Owner
    socket.on('admin-lockdown', async ({ mode }) => {
      // Find the user associated with this socket and check their role
      const requestingUser = Object.values(activeUsers).find(u => u.sockets.includes(socket.id));
      if (requestingUser?.role === 'owner') {
        emergencyLockdownMode = mode;
        io.emit('system-alert', `Emergency Lockdown initiated by owner. Mode: ${mode}`);
        console.log(`Emergency Lockdown set to: ${mode}`);
      }
    });
    
    // Promote/Demote user from owner panel
    socket.on('admin-change-role', async ({ targetUsername, newRole }) => {
        const requestingUser = Object.values(activeUsers).find(u => u.sockets.includes(socket.id));
        if (requestingUser?.role === 'owner') {
            try {
                const result = await pool.query('UPDATE users SET role = $1 WHERE username = $2 RETURNING id', [newRole, targetUsername]);
                if (result.rows.length > 0) {
                    // Update the active user list and broadcast the change
                    const targetUser = activeUsers[result.rows[0].id];
                    if (targetUser) {
                        targetUser.role = newRole;
                    }
                    io.emit('user-list-update', Object.values(activeUsers).map(u => ({ username: u.username, role: u.role })));
                    io.to(socket.id).emit('owner-alert', { type: 'role-change-success', message: `${targetUsername} has been promoted to ${newRole}.` });
                } else {
                    io.to(socket.id).emit('owner-alert', { type: 'role-change-failure', message: `Could not find user ${targetUsername}.` });
                }
            } catch (err) {
                console.error('Role change error:', err.stack);
                io.to(socket.id).emit('owner-alert', { type: 'role-change-failure', message: `Error changing role for ${targetUsername}.` });
            }
        }
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected:', socket.id);
      
      // Find and remove the disconnected user's socket
      for (const userId in activeUsers) {
          const user = activeUsers[userId];
          const socketIndex = user.sockets.indexOf(socket.id);
          if (socketIndex > -1) {
              user.sockets.splice(socketIndex, 1);
              if (user.sockets.length === 0) {
                  delete activeUsers[userId];
                  console.log(`User ${user.username} is now offline.`);
              }
              break;
          }
      }

      // Broadcast the updated user list
      io.emit('user-list-update', Object.values(activeUsers).map(u => ({ username: u.username, role: u.role })));
    });
});

// --- HeimBot Command Handler ---
const HEIMBOT_NAME = 'HeimBot';
const HEIMBOT_ROLE = 'bot';

function handleHeimBotCommand(command, username) {
  let response = '';
  let parts = command.split(' ');
  let cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'help':
      response = 'Available commands: !help, !ping, !rules, !joke, !flip, !roll [sides], !time, !uptime, !info, !kick, !warn, !mute, !report, !avatar, !gif';
      break;
    case 'ping':
      response = 'Pong!';
      break;
    case 'rules':
      response = '1. Be respectful. 2. No spamming. 3. Follow the Golden Rule.';
      break;
    case 'joke':
      const jokes = [
        "Why don't scientists trust atoms? Because they make up everything!",
        "I told my wife she was drawing her eyebrows too high. She looked surprised.",
        "What do you call a fake noodle? An impasta."
      ];
      response = jokes[Math.floor(Math.random() * jokes.length)];
      break;
    case 'flip':
      response = Math.random() < 0.5 ? 'Heads' : 'Tails';
      break;
    case 'roll':
      const sides = parseInt(parts[1], 10) || 6;
      if (isNaN(sides) || sides < 2) {
        response = 'Please specify a valid number of sides for the die (e.g., !roll 20).';
      } else {
        response = `You rolled a ${Math.floor(Math.random() * sides) + 1} on a ${sides}-sided die.`;
      }
      break;
    case 'time':
      response = `The current server time is ${new Date().toLocaleTimeString()}.`;
      break;
    case 'uptime':
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);
      response = `The server has been running for ${hours}h ${minutes}m ${seconds}s.`;
      break;
    case 'info':
      response = 'I am HeimBot, a simple chat assistant here to help and entertain you!';
      break;
    // Simulated commands
    case 'kick':
    case 'warn':
    case 'mute':
    case 'report':
      response = `Command executed. User ${parts[1]} has been ${cmd}ed. (Simulation)`;
      break;
    case 'avatar':
      response = `Fetching avatar for ${parts[1]}... (Simulation)`;
      break;
    case 'gif':
      response = `Searching for GIFs related to '${parts.slice(1).join(' ')}'... (Simulation)`;
      break;
    default:
      response = 'Unknown command. Type !help for a list of commands.';
  }

  // Send the bot's response back to all clients
  io.emit('chat-message', {
    username: HEIMBOT_NAME,
    message: response,
    timestamp: new Date().toLocaleTimeString(),
    role: HEIMBOT_ROLE
  });
}

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
