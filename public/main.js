// --- CLIENT-SIDE LOGIC ---

// --- GLOBAL VARIABLES & STATE ---
const screens = {
  join: document.getElementById('join-screen'),
  auth: document.getElementById('auth-screen'),
  _2fa: document.getElementById('2fa-screen'),
  faceid: document.getElementById('faceid-screen'),
  buddy: document.getElementById('buddy-screen'),
  chat: document.getElementById('chat-screen'),
  admin: document.getElementById('admin-panel')
};

let currentUser = null;
let socket = null;
const messagesContainer = document.getElementById('messages-container');
const userList = document.getElementById('user-list');

// --- UTILITY FUNCTIONS ---
function switchScreen(screenId) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  if (screens[screenId]) {
    screens[screenId].classList.add('active');
  }
}

function showMessage(elementId, text, isSuccess = false) {
  const element = document.getElementById(elementId);
  element.textContent = text;
  element.classList.remove('hidden');
  element.classList.remove(isSuccess ? 'error' : 'success');
  element.classList.add(isSuccess ? 'success' : 'error');
}

function showLoading(elementId, show) {
  document.getElementById(elementId).classList.toggle('hidden', !show);
}

function getDeviceId() {
  return FingerprintJS.load().then(fp => fp.get()).then(result => result.visitorId);
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function closeModal() {
  document.getElementById('message-modal').classList.add('hidden');
}

function showModal(title, text) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message-text').textContent = text;
  document.getElementById('message-modal').classList.remove('hidden');
}

// --- RENDERING FUNCTIONS ---
function renderMessages(msgs) {
  messagesContainer.innerHTML = '';
  msgs.forEach(msg => renderMessage(msg, true));
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderMessage(msg, isInitial = false) {
  const isSentByMe = currentUser && msg.username === currentUser.username;
  const isBot = msg.role === 'bot';

  const messageElement = document.createElement('div');
  messageElement.classList.add('message-item');
  if (isSentByMe) {
    messageElement.classList.add('sent');
  }
  if (isBot) {
    messageElement.classList.add('bot');
  }

  const contentWrapper = document.createElement('div');
  contentWrapper.classList.add('message-content-wrapper');

  const userInfo = document.createElement('div');
  userInfo.classList.add('message-info');

  const usernameSpan = document.createElement('span');
  usernameSpan.classList.add('message-username');
  usernameSpan.textContent = msg.username;
  userInfo.appendChild(usernameSpan);

  const roleSpan = document.createElement('span');
  roleSpan.classList.add('message-role');
  roleSpan.textContent = `(${msg.role})`;
  userInfo.appendChild(roleSpan);

  if (msg.isVerified) {
    const verifiedIcon = document.createElement('i');
    verifiedIcon.classList.add('fas', 'fa-check-circle', 'verified-icon');
    userInfo.appendChild(verifiedIcon);
  }

  contentWrapper.appendChild(userInfo);

  if (msg.isPoll) {
    const pollContainer = document.createElement('div');
    pollContainer.classList.add('poll-content');

    const question = document.createElement('p');
    question.classList.add('poll-question');
    question.textContent = msg.question;
    pollContainer.appendChild(question);

    const optionsList = document.createElement('ul');
    optionsList.classList.add('poll-options-list');

    msg.options.forEach(option => {
      const optionItem = document.createElement('li');
      optionItem.classList.add('poll-option-item');
      optionItem.dataset.pollId = msg.id;
      optionItem.dataset.option = option.text;

      const optionText = document.createElement('span');
      optionText.classList.add('poll-option-text');
      optionText.textContent = option.text;
      optionItem.appendChild(optionText);

      const voteCount = document.createElement('span');
      voteCount.classList.add('poll-vote-count');
      voteCount.textContent = option.votes;
      optionItem.appendChild(voteCount);

      optionItem.addEventListener('click', () => {
        socket.emit('vote_poll', { pollId: msg.id, option: option.text });
      });

      optionsList.appendChild(optionItem);
    });

    pollContainer.appendChild(optionsList);
    contentWrapper.appendChild(pollContainer);
  } else if (msg.isGif) {
    const gifImage = document.createElement('img');
    gifImage.src = msg.content;
    gifImage.classList.add('gif-content');
    contentWrapper.appendChild(gifImage);
  } else {
    const messageText = document.createElement('p');
    messageText.classList.add('message-text');
    messageText.textContent = msg.content;
    contentWrapper.appendChild(messageText);
  }

  messageElement.appendChild(contentWrapper);

  if (isInitial) {
    messagesContainer.appendChild(messageElement);
  } else {
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function renderUsers(users) {
  userList.innerHTML = '';
  users.forEach(user => {
    const userItem = document.createElement('li');
    userItem.dataset.username = user.username;
    userItem.innerHTML = `
      <div class="user-status ${user.status}"></div>
      <div class="user-info">
        <span class="username">${user.username}</span>
        <span class="user-role">${user.role}</span>
        ${user.isVerified ? '<i class="fa-solid fa-circle-check verified-icon"></i>' : ''}
      </div>
    `;
    userList.appendChild(userItem);
  });
}

function renderGifs(gifs) {
  const gifResults = document.getElementById('gif-results');
  gifResults.innerHTML = '';
  gifs.forEach(gif => {
    const imgWrapper = document.createElement('div');
    imgWrapper.classList.add('gif-result-item');
    const img = document.createElement('img');
    img.src = gif.url;
    img.alt = 'Giphy GIF';
    img.addEventListener('click', () => {
      socket.emit('chat_message', gif.url);
      document.getElementById('gif-keyboard').classList.add('hidden');
    });
    imgWrapper.appendChild(img);
    gifResults.appendChild(imgWrapper);
  });
}

// --- EVENT LISTENERS & FORM SUBMISSIONS ---

// Join Code Form
document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('join-code').value;
  const messageElement = document.getElementById('join-message');
  const response = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const result = await response.json();
  if (result.success) {
    showMessage('join-message', 'Code accepted! Proceeding to login...', true);
    setTimeout(() => {
      switchScreen('auth');
    }, 1000);
  } else {
    showMessage('join-message', result.message);
  }
});

// Login Form
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showLoading('auth-loading', true);
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const deviceId = await getDeviceId();
  document.getElementById('device-id').value = deviceId;

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, deviceId })
  });
  const result = await response.json();
  showLoading('auth-loading', false);

  if (result.success) {
    if (result.nextStep === '2fa') {
      document.getElementById('2fa-screen').dataset.username = username;
      switchScreen('2fa');
    } else if (result.nextStep === 'faceId') {
      document.getElementById('faceid-screen').dataset.username = username;
      // Start webcam on face ID screen
      const video = document.getElementById('webcam');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.play();
      } catch (err) {
        showMessage('faceid-message', 'Error accessing webcam. Please allow access.');
      }
      switchScreen('faceid');
    } else if (result.nextStep === 'buddy') {
      // Logic for buddy system
      switchScreen('buddy');
    } else {
      currentUser = result.user;
      connectToChat(currentUser);
    }
  } else {
    showMessage('auth-message', result.message);
  }
});

// 2FA Form
document.getElementById('2fa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('2fa-screen').dataset.username;
  const token = document.getElementById('2fa-token').value;
  const response = await fetch('/api/2fa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, token })
  });
  const result = await response.json();
  if (result.success) {
    currentUser = result.user;
    connectToChat(currentUser);
  } else {
    showMessage('2fa-message', result.message);
  }
});

// Face ID Form
document.getElementById('faceid-capture-btn').addEventListener('click', async () => {
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('face-canvas');
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Simulate Face ID vector generation
    const faceVector = [Math.random(), Math.random(), Math.random()]; // Simulated vector
    
    const username = document.getElementById('faceid-screen').dataset.username;
    const response = await fetch('/api/faceid/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, faceVector })
    });
    const result = await response.json();
    if (result.success) {
        showMessage('faceid-message', 'Face ID verified! Logging in...', true);
        currentUser = result.user;
        connectToChat(currentUser);
    } else {
        showMessage('faceid-message', result.message);
    }
});

// Chat Input
document.getElementById('send-btn').addEventListener('click', () => {
  const input = document.getElementById('message-input');
  if (input.value.trim()) {
    socket.emit('chat_message', input.value);
    input.value = '';
  }
});

document.getElementById('message-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('send-btn').click();
  }
});

// Giphy Button
document.getElementById('gif-btn').addEventListener('click', () => {
  const gifKeyboard = document.getElementById('gif-keyboard');
  gifKeyboard.classList.toggle('hidden');
});

// Giphy Search
document.getElementById('gif-search-input').addEventListener('input', async (e) => {
  const searchTerm = e.target.value;
  if (searchTerm.length > 2) {
    const response = await fetch('/api/giphy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchTerm })
    });
    const result = await response.json();
    if (result.success) {
      renderGifs(result.gifs);
    } else {
      showModal('Error', result.message);
    }
  }
});

// Poll Button
document.getElementById('poll-btn').addEventListener('click', () => {
  document.getElementById('poll-modal').classList.remove('hidden');
});

// Add Poll Option
document.getElementById('add-option-btn').addEventListener('click', () => {
  const container = document.getElementById('poll-options-container');
  const input = document.createElement('input');
  input.type = 'text';
  input.classList.add('poll-option');
  input.placeholder = `Option ${container.children.length + 1}`;
  input.required = true;
  container.appendChild(input);
});

// Poll Form
document.getElementById('poll-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const question = document.getElementById('poll-question').value;
  const options = Array.from(document.querySelectorAll('.poll-option')).map(input => input.value).filter(val => val.trim() !== '');
  if (options.length < 2) {
    showModal('Poll Error', 'Please enter at least two options.');
    return;
  }
  socket.emit('create_poll', { question, options });
  document.getElementById('poll-modal').classList.add('hidden');
});

// Close Poll Modal
document.getElementById('close-poll-modal').addEventListener('click', () => {
  document.getElementById('poll-modal').classList.add('hidden');
});

// --- ADMIN PANEL FUNCTIONS & LISTENERS ---
function setupAdminPanel() {
  document.querySelectorAll('.admin-menu li').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.admin-menu li').forEach(li => li.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.remove('active'));
      item.classList.add('active');
      const panelId = item.dataset.panel;
      document.getElementById(`${panelId}-panel`).classList.add('active');
    });
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    socket.disconnect();
    currentUser = null;
    switchScreen('auth');
    showMessage('auth-message', 'Logged out successfully.', true);
  });
}

function renderSecurityLogs(logs) {
  const container = document.getElementById('logs-container');
  container.innerHTML = '';
  logs.forEach(log => {
    const logItem = document.createElement('div');
    logItem.classList.add('log-item');
    logItem.innerHTML = `
      <div class="log-item-details">
        <p><span>Type:</span> ${log.type}</p>
        <p><span>User:</span> ${log.user}</p>
        <p><span>Details:</span> ${log.details}</p>
      </div>
      <div class="log-item-meta">
        <p>${new Date(log.timestamp).toLocaleString()}</p>
        <p>${log.ip}</p>
      </div>
    `;
    container.appendChild(logItem);
  });
}

function renderUserManagement(users) {
  const container = document.getElementById('user-management-container');
  container.innerHTML = '';
  users.forEach(user => {
    const userItem = document.createElement('div');
    userItem.classList.add('user-manage-item');
    userItem.innerHTML = `
      <div class="user-info">
        <span class="username">${user.username}</span>
        <span class="user-role">(${user.role})</span>
        ${user.isVerified ? '<i class="fa-solid fa-circle-check verified-icon"></i>' : ''}
      </div>
      <div class="user-manage-actions">
        <button class="btn secondary" data-action="toggle_verified" data-user="${user.username}">
          ${user.isVerified ? 'Unverify' : 'Verify'}
        </button>
      </div>
    `;
    container.appendChild(userItem);
  });

  container.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'toggle_verified') {
      const username = e.target.dataset.user;
      socket.emit('admin_action', { action: 'toggle_user_verified', username });
    }
  });
}

// --- USER SETTINGS FUNCTIONS & LISTENERS ---
function setupSettingsPanel() {
    // Open settings modal
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('hidden');
    });
    // Close settings modal
    document.getElementById('close-settings-modal').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });
    // Open 2FA setup modal
    document.getElementById('2fa-setup-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
        document.getElementById('2fa-setup-modal').classList.remove('hidden');
        socket.emit('request_2fa_setup');
    });
    // Close 2FA setup modal
    document.getElementById('close-2fa-setup-modal').addEventListener('click', () => {
        document.getElementById('2fa-setup-modal').classList.add('hidden');
    });
    // Submit 2FA setup form
    document.getElementById('2fa-setup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const token = document.getElementById('2fa-setup-token').value;
        socket.emit('verify_2fa_setup', { token });
    });
}

// --- SOCKET.IO CONNECTION & LISTENERS ---
function connectToChat(user) {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
    socket.emit('register_user_socket', user);
    if (user.role === 'owner') {
      switchScreen('admin');
      setupAdminPanel();
    } else {
      switchScreen('chat');
      setupSettingsPanel();
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server.');
  });

  socket.on('initial_data', (data) => {
    const formattedMessages = data.messages.map(msg => {
      // For polls
      if (msg.content.includes('<poll>')) {
        const pollId = msg.content.match(/<poll>(.*?)<\/poll>/)[1];
        const poll = data.polls.find(p => p.id === pollId);
        if (poll) {
          return {
            ...msg,
            isPoll: true,
            question: poll.question,
            options: poll.options
          };
        }
      }
      return msg;
    });

    renderMessages(formattedMessages);
    renderUsers(data.users);
  });

  socket.on('user_list_update', (users) => {
    renderUsers(users);
  });

  socket.on('new_message', (msg) => {
    renderMessage(msg);
  });

  socket.on('new_poll', (poll) => {
    const pollMessage = {
      id: poll.id,
      username: poll.creator,
      role: 'user',
      isPoll: true,
      question: poll.question,
      options: poll.options,
      timestamp: new Date()
    };
    renderMessage(pollMessage);
  });

  socket.on('poll_update', (updatedPoll) => {
    // Find the message element for the poll and re-render it
    const messageElement = document.querySelector(`.message-item[data-poll-id="${updatedPoll.id}"]`);
    if (messageElement) {
      // Update poll display
      const optionsList = messageElement.querySelector('.poll-options-list');
      optionsList.innerHTML = ''; // Clear and re-render options
      updatedPoll.options.forEach(option => {
        const optionItem = document.createElement('li');
        optionItem.classList.add('poll-option-item');
        optionItem.innerHTML = `
          <span class="poll-option-text">${option.text}</span>
          <span class="poll-vote-count">${option.votes}</span>
        `;
        optionsList.appendChild(optionItem);
      });
    }
  });

  // Admin-specific listeners
  socket.on('admin_data', (data) => {
    renderSecurityLogs(data.securityLogs);
    renderUserManagement(data.users);
  });

  socket.on('security_alert', (log) => {
    renderSecurityLogs(data.securityLogs);
    showModal('New Security Alert', `${log.type} for user ${log.user}.`);
  });

  socket.on('users_data', (users) => {
    renderUserManagement(users);
  });
  
  // 2FA Setup listeners
  socket.on('2fa_setup_response', (data) => {
      if (data.success) {
          const qrCanvas = document.getElementById('2fa-qr-canvas');
          QRCode.toCanvas(qrCanvas, data.qrCode, (err) => {
              if (err) console.error(err);
              document.getElementById('2fa-setup-text').textContent = 'Scan this QR code and enter the 6-digit code below to confirm.';
              document.getElementById('2fa-qr-container').style.display = 'block';
          });
      } else {
          showModal('2FA Setup Error', data.message);
      }
  });

  socket.on('2fa_setup_verify_response', (data) => {
      if (data.success) {
          showModal('Success', data.message);
          document.getElementById('2fa-setup-modal').classList.add('hidden');
      } else {
          showModal('Verification Failed', data.message);
      }
  });
}

// Initial Screen
switchScreen('join');
