// --- DEPENDENCIES ---
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// --- FIX: Explicitly handle the root route ---
// This ensures that when a user navigates to the root URL,
// the server correctly sends the index.html file.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- IN-MEMORY 'DATABASE' & CONFIGURATION ---
const users = [
  {
    username: 'Austin ;)',
    password: 'AME',
    role: 'owner',
    isVerified: true,
    devices: [],
    buddy: null,
    is2FA_Enabled: false,
    _2faSecret: null,
    faceIdVector: null,
    status: 'online'
  }
];

const messages = [];
const polls = [];
const securityLogs = [];
const ipControls = {
  allowed: [],
  blocked: []
};
let emergencyLockdown = {
  enabled: false,
  mode: null
};
let requireAccountApproval = false;

// HeimBot configuration
const heimBot = {
  username: 'HeimBot 🤖',
  role: 'bot',
  isVerified: true,
  status: 'online'
};
let serverStartTime = new Date();

// Helper function to log security events
function logSecurityEvent(type, user, details) {
  const ip = user.ip || 'Unknown';
  const location = user.location || 'Unknown';
  securityLogs.push({
    id: uuidv4(),
    timestamp: new Date(),
    type,
    user: user.username,
    ip,
    location,
    device: user.device || 'Unknown',
    details: details
  });
  io.to('owner').emit('security_alert', securityLogs[securityLogs.length - 1]);
}

// --- API ENDPOINTS & MIDDLEWARE ---
app.post('/api/join', (req, res) => {
  const { code } = req.body;
  if (code === 'HMS') {
    res.json({ success: true, message: 'Join code accepted.' });
  } else {
    res.json({ success: false, message: 'Incorrect join code.' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password, deviceId } = req.body;
  const user = users.find(u => u.username === username);

  if (!user || user.password !== password) {
    logSecurityEvent('Login Failed', { username, ip: req.ip, device: deviceId }, 'Incorrect username or password.');
    return res.json({ success: false, message: 'Invalid credentials.' });
  }

  // Multi-step login & verification
  if (!user.devices.includes(deviceId)) {
    logSecurityEvent('Login Attempt', user, 'Unrecognized device detected.');
    if (user.faceIdVector) {
      return res.json({ success: true, nextStep: 'faceId', message: 'Unrecognized device. Face ID required.' });
    }
    if (user.is2FA_Enabled) {
      return res.json({ success: true, nextStep: '2fa', message: 'Unrecognized device. 2FA required.' });
    }
    if (user.buddy) {
      // Simulate buddy system
      io.to(user.buddy).emit('buddy_request', { user: user.username, deviceId });
      return res.json({ success: true, nextStep: 'buddy', message: 'Unrecognized device. Buddy approval required.' });
    }
  }

  logSecurityEvent('Login Success', user, 'Successfully logged in.');
  user.devices.push(deviceId);
  res.json({ success: true, nextStep: 'complete', user: user });
});

app.post('/api/2fa/verify', (req, res) => {
  const { username, token } = req.body;
  const user = users.find(u => u.username === username);

  if (!user || !user.is2FA_Enabled) {
    return res.json({ success: false, message: '2FA not enabled for this user.' });
  }

  const verified = speakeasy.totp.verify({
    secret: user._2faSecret.base32,
    encoding: 'base32',
    token: token
  });

  if (verified) {
    logSecurityEvent('2FA Verified', user, 'Successfully verified with 2FA.');
    res.json({ success: true, message: 'Verification successful.', user });
  } else {
    logSecurityEvent('2FA Failed', user, 'Incorrect 2FA token.');
    res.json({ success: false, message: 'Invalid 2FA token.' });
  }
});

app.post('/api/faceid/verify', async (req, res) => {
  const { username, faceVector } = req.body; // Simulated face vector from client
  const user = users.find(u => u.username === username);

  if (!user || !user.faceIdVector) {
    return res.json({ success: false, message: 'Face ID not enrolled.' });
  }

  // Simulate comparison
  const similarityScore = Math.random() * (0.95 - 0.8) + 0.8; // Simulate a high score
  const isMatch = similarityScore > 0.85;

  if (isMatch) {
    logSecurityEvent('Face ID Verified', user, `Successfully verified with Face ID. Score: ${similarityScore.toFixed(2)}`);
    res.json({ success: true, message: 'Verification successful.', user });
  } else {
    logSecurityEvent('Face ID Failed', user, `Failed to verify with Face ID. Score: ${similarityScore.toFixed(2)}`);
    res.json({ success: false, message: 'Face ID verification failed.' });
  }
});

app.post('/api/giphy', async (req, res) => {
  const searchTerm = req.body.searchTerm;
  const apiKey = process.env.GIPHY_API_KEY;
  const limit = 25;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(searchTerm)}&limit=${limit}&rating=g`;

  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'Giphy API key not configured.' });
  }

  try {
    const response = await axios.get(url);
    const gifs = response.data.data.map(gif => ({
      id: gif.id,
      url: gif.images.fixed_height.url
    }));
    res.json({ success: true, gifs });
  } catch (error) {
    console.error('Giphy API error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching GIFs from Giphy API.' });
  }
});

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Initial user list and message sync
  const currentUserList = users.map(u => ({ username: u.username, role: u.role, isVerified: u.isVerified }));
  socket.emit('initial_data', {
    messages,
    users: currentUserList,
    polls,
    bot: heimBot
  });

  // Owner joins the owner channel
  socket.on('register_user_socket', (userData) => {
    socket.userData = userData; // Store user data on the socket
    socket.join(userData.username); // Join a private room for DMs
    if (userData.role === 'owner') {
      socket.join('owner');
      socket.emit('admin_data', { securityLogs, ipControls, emergencyLockdown, requireAccountApproval });
      socket.emit('users_data', users.map(u => ({ username: u.username, role: u.role, isVerified: u.isVerified, status: u.status })));
    }
    const user = users.find(u => u.username === userData.username);
    if(user) {
      user.status = 'online';
    }
    io.emit('user_list_update', users.map(u => ({ username: u.username, role: u.role, isVerified: u.isVerified, status: u.status })));
    console.log(`${userData.username} is now online.`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.userData) {
      const user = users.find(u => u.username === socket.userData.username);
      if (user) {
        user.status = 'offline';
      }
      io.emit('user_list_update', users.map(u => ({ username: u.username, role: u.role, isVerified: u.isVerified, status: u.status })));
    }
  });

  // Chat message handling
  socket.on('chat_message', (msg) => {
    const messageObject = {
      id: uuidv4(),
      username: socket.userData.username,
      role: socket.userData.role,
      content: msg,
      timestamp: new Date()
    };
    messages.push(messageObject);
    io.emit('new_message', messageObject);

    // Check for HeimBot commands
    if (msg.startsWith('!')) {
      handleHeimBotCommand(msg, socket);
    }
  });

  // Direct Message handling
  socket.on('dm_message', ({ recipient, content }) => {
    const sender = socket.userData.username;
    const messageObject = {
      id: uuidv4(),
      from: sender,
      to: recipient,
      content: content,
      timestamp: new Date()
    };
    // Send message to both sender and recipient's private rooms
    io.to(sender).emit('new_dm', messageObject);
    io.to(recipient).emit('new_dm', messageObject);
  });

  // Poll creation
  socket.on('create_poll', (pollData) => {
    const newPoll = {
      id: uuidv4(),
      question: pollData.question,
      options: pollData.options.map(opt => ({ text: opt, votes: 0 })),
      creator: socket.userData.username
    };
    polls.push(newPoll);
    io.emit('new_poll', newPoll);
  });

  // Poll voting
  socket.on('vote_poll', (data) => {
    const poll = polls.find(p => p.id === data.pollId);
    if (poll) {
      const option = poll.options.find(opt => opt.text === data.option);
      if (option) {
        option.votes++;
        io.emit('poll_update', poll);
      }
    }
  });

  // 2FA Setup Flow
  socket.on('request_2fa_setup', () => {
    const secret = speakeasy.generateSecret({ length: 20 });
    const user = users.find(u => u.username === socket.userData.username);
    if (user) {
      user._2faSecret = secret;
      QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
        if (err) {
          console.error('QR code generation error:', err);
          return socket.emit('2fa_setup_response', { success: false, message: 'Failed to generate QR code.' });
        }
        socket.emit('2fa_setup_response', { success: true, qrCode: data_url });
      });
    }
  });

  socket.on('verify_2fa_setup', ({ token }) => {
    const user = users.find(u => u.username === socket.userData.username);
    if (!user || !user._2faSecret) {
      return socket.emit('2fa_setup_verify_response', { success: false, message: '2FA setup not initiated.' });
    }

    const verified = speakeasy.totp.verify({
      secret: user._2faSecret.base32,
      encoding: 'base32',
      token: token
    });

    if (verified) {
      user.is2FA_Enabled = true;
      socket.emit('2fa_setup_verify_response', { success: true, message: '2FA enabled successfully!' });
    } else {
      socket.emit('2fa_setup_verify_response', { success: false, message: 'Invalid token. Please try again.' });
    }
  });

  // Admin controls
  socket.on('admin_action', (data) => {
    if (socket.userData.role !== 'owner') {
      return socket.emit('error', 'Unauthorized access.');
    }

    if (data.action === 'toggle_user_verified') {
      const userToUpdate = users.find(u => u.username === data.username);
      if (userToUpdate) {
        userToUpdate.isVerified = !userToUpdate.isVerified;
        io.emit('user_list_update', users.map(u => ({ username: u.username, role: u.role, isVerified: u.isVerified })));
        logSecurityEvent('Admin Action', socket.userData, `Toggled verification for ${data.username}.`);
      }
    }
    // Other admin actions can be added here
    if (data.action === 'ip_control') {
      if (data.type === 'allow') {
        ipControls.allowed.push(data.ip);
      } else if (data.type === 'block') {
        ipControls.blocked.push(data.ip);
      }
      logSecurityEvent('Admin Action', socket.userData, `${data.type}ed IP ${data.ip}.`);
    }
  });
});

// --- HEIMBOT COMMAND HANDLER ---
function handleHeimBotCommand(msg, socket) {
  const parts = msg.split(' ');
  const command = parts[0].toLowerCase();
  let response = '';
  let isSimulated = false;

  switch (command) {
    case '!help':
      response = `Available commands: !help, !ping, !rules, !joke, !flip, !roll [sides], !time, !uptime, !info, !kick, !warn, !mute, !report, !avatar, !gif`;
      break;
    case '!ping':
      response = `Pong!`;
      break;
    case '!rules':
      response = `1. Be respectful. 2. No spam. 3. Have fun!`;
      break;
    case '!joke':
      const jokes = [
        "Why don't scientists trust atoms? Because they make up everything!",
        "What do you call a fake noodle? An impasta.",
        "Why did the scarecrow win an award? Because he was outstanding in his field!"
      ];
      response = jokes[Math.floor(Math.random() * jokes.length)];
      break;
    case '!flip':
      response = `The coin landed on... **${Math.random() > 0.5 ? 'Heads' : 'Tails'}!**`;
      break;
    case '!roll':
      const sides = parseInt(parts[1], 10) || 6;
      response = `Rolling a ${sides}-sided die... it landed on **${Math.floor(Math.random() * sides) + 1}**!`;
      break;
    case '!time':
      response = `The current server time is ${new Date().toLocaleString()}.`;
      break;
    case '!uptime':
      const uptimeInSeconds = Math.floor((new Date() - serverStartTime) / 1000);
      const hours = Math.floor(uptimeInSeconds / 3600);
      const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
      const seconds = uptimeInSeconds % 60;
      response = `I have been online for ${hours}h ${minutes}m ${seconds}s.`;
      break;
    case '!info':
      response = `I am HeimBot, your friendly neighborhood bot. Here to help and make the chat more fun!`;
      break;
    // Simulated commands
    case '!kick':
    case '!warn':
    case '!mute':
    case '!report':
    case '!avatar':
    case '!gif':
      isSimulated = true;
      response = `Command "${command}" is simulated. It would typically affect a user or fetch data from an API.`;
      break;
    default:
      response = `Unknown command. Type '!help' to see a list of commands.`;
      break;
  }

  const messageObject = {
    id: uuidv4(),
    username: heimBot.username,
    role: heimBot.role,
    content: response,
    timestamp: new Date(),
    isSimulated
  };
  messages.push(messageObject);
  io.emit('new_message', messageObject);
}

// --- START THE SERVER ---
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
