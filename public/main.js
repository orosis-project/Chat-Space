// main.js - Chat Space Frontend Logic

// --- Global DOM Elements ---
const joinScreen = document.getElementById('join-screen');
const authScreen = document.getElementById('auth-screen');
const verificationScreen = document.getElementById('verification-screen');
const chatScreen = document.getElementById('chat-screen');
const settingsModal = document.getElementById('settings-modal');

const joinForm = document.getElementById('join-form');
const joinCodeInput = document.getElementById('join-code');
const joinError = document.getElementById('join-error-message');

const authSubtitle = document.getElementById('auth-subtitle');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authMessage = document.getElementById('auth-message');
const showRegisterLink = document.getElementById('show-register');
const showLoginLink = document.getElementById('show-login');
const pendingApprovalBanner = document.getElementById('pending-approval-banner');

const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages');
const onlineUsersList = document.getElementById('online-users');

const giphyButton = document.getElementById('giphy-button');
const giphyPanel = document.getElementById('giphy-panel');
const giphySearchInput = document.getElementById('giphy-search-input');
const giphyResultsGrid = document.getElementById('giphy-results');

const pollButton = document.getElementById('poll-button');
const pollModal = document.getElementById('poll-modal');
const pollForm = document.getElementById('poll-form');
const addOptionButton = document.getElementById('add-option-button');
const pollOptionsContainer = document.getElementById('poll-options-container');

const verificationSubtitle = document.getElementById('verification-subtitle');
const verificationMessage = document.getElementById('verification-message');
const twofaForm = document.getElementById('2fa-form');
const twofaCodeInput = document.getElementById('2fa-code');
const faceIdContainer = document.getElementById('face-id-container');
const faceCaptureButton = document.getElementById('face-capture-button');
const faceVideo = document.getElementById('face-video');
const buddySystemContainer = document.getElementById('buddy-system-container');
const buddyRequestButton = document.getElementById('buddy-request-button');
const buddyUsernameInput = document.getElementById('buddy-username');

const messageModal = document.getElementById('message-modal');
const messageModalTitle = document.getElementById('message-modal-title');
const messageModalText = document.getElementById('message-modal-text');
const buddyRequestActions = document.getElementById('buddy-request-actions');
const buddyApproveButton = document.getElementById('buddy-approve-button');
const buddyDenyButton = document.getElementById('buddy-deny-button');

const ownerDashboardContainer = document.getElementById('owner-dashboard-container');
const settingsButton = document.getElementById('settings-button');
const closeSettingsModalButton = document.getElementById('close-settings-modal');
const setup2faForm = document.getElementById('2fa-settings');
const qrCodeImage = document.getElementById('qr-code-image');
const setup2faCodeInput = document.getElementById('2fa-setup-code');
const setup2faVerifyButton = document.getElementById('2fa-setup-verify-button');
const twofaStatusMessage = document.getElementById('2fa-status-message');


// --- Global State ---
let user = null;
let socket = null;
let deviceId = null;
let activeModal = null;
let currentBuddyRequestId = null;

// --- Utility Functions ---
function getDeviceId() {
  if (deviceId) {
    return Promise.resolve(deviceId);
  }
  return FingerprintJS.load()
    .then(fp => fp.get())
    .then(result => {
      deviceId = result.visitorId;
      return deviceId;
    });
}

function switchScreen(screen) {
  const screens = [joinScreen, authScreen, verificationScreen, chatScreen, settingsModal];
  screens.forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

function showMessage(username, message, timestamp, role = 'user') {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  
  let roleClass = '';
  if (role === 'owner') roleClass = 'role-owner';
  else if (role === 'bot') roleClass = 'role-bot';
  else roleClass = 'role-user';

  const userSpan = `<span class="username ${roleClass}">${username}</span>`;
  const timeSpan = `<span class="timestamp">${new Date(timestamp).toLocaleTimeString()}</span>`;
  const meta = `<div class="message-meta">${userSpan} ${timeSpan}</div>`;

  let content = `<p class="message-text">${message}</p>`;
  if (message.startsWith('http')) {
    const imageUrl = message;
    content = `<img src="${imageUrl}" alt="GIF" class="chat-image">`;
  }

  messageElement.innerHTML = `${meta}${content}`;
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function openModal(modal) {
  activeModal = modal;
  modal.classList.remove('hidden');
}

function closeModal() {
  if (activeModal) {
    activeModal.classList.add('hidden');
    activeModal = null;
  }
}

// --- Main Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
  getDeviceId();
  // Ensure only the join screen is visible on page load
  const screens = [authScreen, verificationScreen, chatScreen, settingsModal, ownerDashboardContainer];
  screens.forEach(s => s.classList.add('hidden'));
  joinScreen.classList.remove('hidden');
  
  // Add a global keyboard listener for redirects
  document.addEventListener('keydown', (e) => {
    if (user) {
        if (e.key === '`') {
            window.location.href = 'https://classroom.google.com';
        }
        if (e.key === '~' && (user.role === 'moderator' || user.role === 'owner' || user.role === 'co-owner' || user.role === 'manager')) {
            window.location.href = 'https://classroom.google.com';
        }
    }
  });
});

// Join Form Submission
joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = joinCodeInput.value.trim();
  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await response.json();
    if (data.success) {
      joinScreen.classList.add('hidden');
      authScreen.classList.remove('hidden');
      checkAccountApprovalSetting();
    } else {
      joinError.textContent = data.message;
    }
  } catch (err) {
    joinError.textContent = 'Server error. Please try again later.';
  }
});

async function checkAccountApprovalSetting() {
    try {
        const response = await fetch('/api/settings/approval');
        const data = await response.json();
        if (data.requiresApproval) {
            pendingApprovalBanner.classList.remove('hidden');
        } else {
            pendingApprovalBanner.classList.add('hidden');
        }
    } catch (err) {
        console.error('Error fetching approval setting:', err);
    }
}

// Auth Form Toggling
showRegisterLink.addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  authSubtitle.textContent = 'Please register a new account.';
});
showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  authSubtitle.textContent = 'Please sign in or register.';
});

// Login Form Submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = e.target.elements['login-username'].value;
  const password = e.target.elements['login-password'].value;
  const deviceId = await getDeviceId();

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceId })
    });
    const data = await response.json();
    
    if (data.success) {
      user = data.user;
      switch (data.nextStep) {
        case 'success':
          loginSuccess();
          break;
        case '2fa':
          authScreen.classList.add('hidden');
          showVerificationScreen('2fa', data.challengeReason);
          break;
        case 'face-id':
          authScreen.classList.add('hidden');
          showVerificationScreen('face-id', data.challengeReason);
          break;
        case 'device-challenge':
          authScreen.classList.add('hidden');
          showVerificationScreen('unrecognized-device', data.challengeReason);
          break;
      }
    } else {
      authMessage.textContent = data.message;
    }
  } catch (err) {
    authMessage.textContent = 'Server error. Please try again later.';
  }
});

// Registration Form Submission
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = e.target.elements['register-username'].value;
  const password = e.target.elements['register-password'].value;

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    authMessage.textContent = data.message;
    if (data.success) {
      // Switch back to login form after successful registration
      registerForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      authSubtitle.textContent = 'Please sign in or register.';
    }
  } catch (err) {
    authMessage.textContent = 'Server error. Please try again later.';
  }
});

function showVerificationScreen(type, message) {
  verificationScreen.classList.remove('hidden');
  verificationSubtitle.textContent = message;
  
  twofaForm.classList.add('hidden');
  faceIdContainer.classList.add('hidden');
  buddySystemContainer.classList.add('hidden');
  
  if (type === '2fa') twofaForm.classList.remove('hidden');
  else if (type === 'face-id') faceIdContainer.classList.remove('hidden');
  else if (type === 'unrecognized-device') buddySystemContainer.classList.remove('hidden');
}

twofaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = twofaCodeInput.value.trim();
  try {
    const response = await fetch('/api/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, token })
    });
    const data = await response.json();
    if (data.success) {
      loginSuccess();
    } else {
      verificationMessage.textContent = data.message;
    }
  } catch (err) {
    verificationMessage.textContent = 'Server error.';
  }
});

faceCaptureButton.addEventListener('click', async () => {
  verificationMessage.textContent = 'Capturing image...';
  // Simulate face capture and API call
  try {
    const response = await fetch('/api/faceid/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, imageBase64: 'simulated_image_data' })
    });
    const data = await response.json();
    if (data.success) {
      loginSuccess();
    } else {
      verificationMessage.textContent = data.message;
    }
  } catch (err) {
    verificationMessage.textContent = 'Server error during Face ID verification.';
  }
});

buddyRequestButton.addEventListener('click', async () => {
  const buddyUsername = buddyUsernameInput.value.trim();
  if (!buddyUsername) {
    verificationMessage.textContent = 'Please enter a buddy\'s username.';
    return;
  }
  socket.emit('buddy-request', { userId: user.id, buddyUsername });
});

// Main Login Success function
function loginSuccess() {
  verificationScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  connectToSocket();
  if (user.role === 'owner' || user.role === 'co-owner' || user.role === 'manager') {
      setupOwnerDashboard();
  }
}

// --- Chat & Socket.IO Logic ---
function connectToSocket() {
  socket = io();

  socket.on('connect', async () => {
    console.log('Connected to socket.io server');
    socket.emit('user-ready', { user: { id: user.id, username: user.username, role: user.role }, deviceId });
  });

  socket.on('chat-message', (data) => {
    showMessage(data.username, data.message, data.timestamp, data.role);
  });
  
  socket.on('load-messages', (messages) => {
    messages.forEach(msg => showMessage(msg.username, msg.message, msg.timestamp, msg.role));
  });

  socket.on('user-list-update', (users) => {
    onlineUsersList.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.classList.add('user-item');
      li.innerHTML = `
        <span class="user-status"></span>
        <span class="username">${u.username}</span>
        <span class="role-badge ${u.role}">${u.role}</span>
      `;
      onlineUsersList.appendChild(li);
    });
  });

  socket.on('poll-new', (poll) => {
    renderPoll(poll);
  });

  socket.on('poll-update', (poll) => {
    // Find and update the existing poll in the messages container
    const pollElement = document.getElementById(`poll-${poll.id}`);
    if (pollElement) {
      const optionsContainer = pollElement.querySelector('.poll-options');
      optionsContainer.innerHTML = '';
      poll.options.forEach((option, index) => {
        const optionEl = document.createElement('li');
        optionEl.classList.add('poll-option');
        optionEl.innerHTML = `
          <span class="poll-option-text">${option.text}</span>
          <span class="poll-vote-count">${option.votes}</span>
        `;
        optionEl.addEventListener('click', () => {
          socket.emit('vote-poll', { pollId: poll.id, optionIndex: index });
        });
        optionsContainer.appendChild(optionEl);
      });
    }
  });

  socket.on('buddy-request-notification', (data) => {
    currentBuddyRequestId = data.requestId;
    messageModalTitle.textContent = 'Buddy System Request';
    messageModalText.textContent = `${data.requesterUsername} is logging in from an unrecognized device and needs your approval.`;
    buddyRequestActions.classList.remove('hidden');
    openModal(messageModal);
  });

  socket.on('buddy-request-approved', (data) => {
    messageModalTitle.textContent = 'Buddy System';
    messageModalText.textContent = data.message;
    buddyRequestActions.classList.add('hidden');
    openModal(messageModal);
  });
  
  socket.on('system-alert', (message) => {
    messageModalTitle.textContent = 'System Alert';
    messageModalText.textContent = message;
    buddyRequestActions.classList.add('hidden');
    openModal(messageModal);
  });
  
  // New socket event listeners for owner notifications
  socket.on('owner-alert', (data) => {
      messageModalTitle.textContent = `Owner Alert: ${data.type}`;
      messageModalText.textContent = data.message;
      openModal(messageModal);
  });
}

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (message) {
    socket.emit('chat-message', {
      userId: user.id,
      username: user.username,
      message,
      role: user.role
    });
    messageInput.value = '';
  }
});

buddyApproveButton.addEventListener('click', () => {
  socket.emit('buddy-request-response', { requestId: currentBuddyRequestId, approved: true });
  closeModal();
});

buddyDenyButton.addEventListener('click', () => {
  socket.emit('buddy-request-response', { requestId: currentBuddyRequestId, approved: false });
  closeModal();
});

// --- Giphy Integration ---
giphyButton.addEventListener('click', () => {
  openModal(giphyPanel);
});

giphySearchInput.addEventListener('input', debounce(async (e) => {
  const searchTerm = e.target.value.trim();
  if (searchTerm.length > 2) {
    try {
      const response = await fetch(`/api/giphy/search?q=${encodeURIComponent(searchTerm)}`);
      const data = await response.json();
      if (data.success) {
        renderGiphyResults(data.data);
      }
    } catch (err) {
      console.error('Giphy search error:', err);
    }
  }
}, 500));

function renderGiphyResults(gifs) {
  giphyResultsGrid.innerHTML = '';
  gifs.forEach(gif => {
    const img = document.createElement('img');
    img.src = gif.images.fixed_height.url;
    img.alt = gif.title;
    img.classList.add('giphy-gif');
    img.addEventListener('click', () => {
      socket.emit('chat-message', {
        userId: user.id,
        username: user.username,
        message: gif.images.original.url,
        role: user.role
      });
      closeModal();
    });
    giphyResultsGrid.appendChild(img);
  });
}

function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

// --- Polls ---
pollButton.addEventListener('click', () => {
  openModal(pollModal);
});

pollForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = document.getElementById('poll-question').value.trim();
  const options = Array.from(document.querySelectorAll('.poll-option-input'))
    .map(input => input.value.trim())
    .filter(val => val.length > 0);

  if (question && options.length >= 2) {
    socket.emit('create-poll', { username: user.username, question, options });
    closeModal();
  } else {
    alert('Please enter a question and at least two options.');
  }
});

addOptionButton.addEventListener('click', () => {
  const newOption = document.createElement('input');
  newOption.type = 'text';
  newOption.classList.add('poll-option-input', 'input-field');
  newOption.placeholder = `Option ${pollOptionsContainer.children.length + 1}`;
  pollOptionsContainer.appendChild(newOption);
});

function renderPoll(poll) {
  const pollElement = document.createElement('div');
  pollElement.classList.add('message', 'poll');
  pollElement.id = `poll-${poll.id}`;
  
  const header = `
    <div class="message-meta">
        <span class="username">${poll.creator}</span>
        <span class="timestamp">${new Date().toLocaleTimeString()}</span>
        <span class="role-badge role-user">Poll</span>
    </div>`;
  const question = `<div class="poll-question">${poll.question}</div>`;
  const optionsList = document.createElement('ul');
  optionsList.classList.add('poll-options');
  
  poll.options.forEach((option, index) => {
    const optionEl = document.createElement('li');
    optionEl.classList.add('poll-option');
    optionEl.innerHTML = `
      <span class="poll-option-text">${option.text}</span>
      <span class="poll-vote-count">${option.votes}</span>
    `;
    optionEl.addEventListener('click', () => {
      socket.emit('vote-poll', { pollId: poll.id, optionIndex: index });
    });
    optionsList.appendChild(optionEl);
  });
  
  pollElement.innerHTML = header + question;
  pollElement.appendChild(optionsList);
  messagesContainer.appendChild(pollElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Close modal event listeners
document.querySelectorAll('.close-modal-button').forEach(button => {
  button.addEventListener('click', closeModal);
});

// --- Settings Modal ---
settingsButton.addEventListener('click', () => {
    openModal(settingsModal);
    // Hide the owner dashboard if it's open
    ownerDashboardContainer.classList.add('hidden');
    // Generate QR code for 2FA setup
    if (user && !user.twofa_secret) {
        setup2faForm.classList.remove('hidden');
        fetch('/api/2fa/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                new QRCode(qrCodeImage, {
                    text: `otpauth://totp/Chat%20Space%20(${user.username})?secret=${data.secret}&issuer=ChatSpace`,
                    width: 128,
                    height: 128
                });
            } else {
                twofaStatusMessage.textContent = 'Error setting up 2FA.';
            }
        });
    } else {
        twofaStatusMessage.textContent = '2FA is already enabled.';
    }
});

closeSettingsModalButton.addEventListener('click', () => {
    closeModal();
});

setup2faVerifyButton.addEventListener('click', () => {
    const token = setup2faCodeInput.value.trim();
    if (token) {
        fetch('/api/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, token })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                twofaStatusMessage.textContent = '2FA successfully enabled!';
                setup2faForm.classList.add('hidden');
                user.twofa_secret = 'enabled'; // Simple way to track on the client
            } else {
                twofaStatusMessage.textContent = 'Invalid 2FA code. Please try again.';
            }
        });
    }
});

// --- Owner Dashboard Logic ---
function setupOwnerDashboard() {
  const dashboardButton = document.createElement('button');
  dashboardButton.id = 'owner-dashboard-button';
  dashboardButton.classList.add('action-button');
  dashboardButton.innerHTML = '<i class="fa-solid fa-gear"></i>';
  document.getElementById('chat-actions').appendChild(dashboardButton);
  
  dashboardButton.addEventListener('click', () => {
    ownerDashboardContainer.classList.toggle('hidden');
    renderOwnerDashboard();
  });
}

async function renderOwnerDashboard() {
  ownerDashboardContainer.innerHTML = '';
  // This is a simple mock-up of the dashboard
  ownerDashboardContainer.innerHTML = `
    <div class="sidebar owner-dashboard">
      <div class="sidebar-header">
        <h2>Owner Dashboard</h2>
      </div>
      <div class="dashboard-section">
        <h3>Security Controls</h3>
        <form id="lockdown-form">
          <label for="lockdown-mode">Emergency Lockdown:</label>
          <select id="lockdown-mode" class="input-field">
              <option value="none">None</option>
              <option value="all">Block All Users</option>
              <option value="unauthenticated">Block Unauthenticated</option>
          </select>
          <button type="submit" class="cta-button">Set Mode</button>
        </form>
      </div>
      <div class="dashboard-section">
        <h3>Security Logs</h3>
        <ul id="security-logs-list"></ul>
      </div>
      <div class="dashboard-section">
        <h3>User Management</h3>
        <ul id="user-management-list"></ul>
      </div>
      <div class="dashboard-section">
        <h3>Rank Powers</h3>
        <ul class="rank-powers-list">
          <li><strong>User:</strong> Basic chat and poll functionality.</li>
          <li><strong>Moderator:</strong> Can kick/warn/mute users.</li>
          <li><strong>Manager:</strong> All Moderator powers + ability to promote/demote to Moderator.</li>
          <li><strong>Co-Owner:</strong> All Manager powers + access to emergency lockdown and IP controls.</li>
          <li><strong>Owner:</strong> All Co-Owner powers + ability to promote/demote all ranks.</li>
        </ul>
      </div>
    </div>
  `;

  document.getElementById('lockdown-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = document.getElementById('lockdown-mode').value;
    socket.emit('admin-lockdown', { mode });
  });
  
  // Fetch and display security logs (simulated)
  const logsList = document.getElementById('security-logs-list');
  try {
    const response = await fetch('/api/admin/security-logs');
    const data = await response.json();
    if (data.success) {
      logsList.innerHTML = '';
      data.logs.forEach(log => {
        const li = document.createElement('li');
        li.textContent = `${new Date(log.timestamp).toLocaleString()}: ${log.description}`;
        logsList.appendChild(li);
      });
    } else {
      logsList.innerHTML = `<li>Error: ${data.message}</li>`;
    }
  } catch (err) {
    logsList.innerHTML = `<li>Error: Failed to fetch logs.</li>`;
  }
  
  // Render user management list
  const userManagementList = document.getElementById('user-management-list');
  const allUsers = Object.values(activeUsers);
  userManagementList.innerHTML = '';
  const ranks = ['user', 'moderator', 'manager', 'co-owner', 'owner'];
  
  allUsers.forEach(u => {
      const li = document.createElement('li');
      li.classList.add('user-management-item');
      
      const select = document.createElement('select');
      select.classList.add('input-field');
      ranks.forEach(rank => {
          const option = document.createElement('option');
          option.value = rank;
          option.textContent = rank;
          if (u.role === rank) {
              option.selected = true;
          }
          select.appendChild(option);
      });
      
      const promoteButton = document.createElement('button');
      promoteButton.textContent = 'Change Rank';
      promoteButton.classList.add('cta-button');
      promoteButton.addEventListener('click', () => {
          const newRole = select.value;
          socket.emit('admin-change-role', { targetUsername: u.username, newRole });
      });

      li.innerHTML = `<span>${u.username}</span>`;
      li.appendChild(select);
      li.appendChild(promoteButton);
      userManagementList.appendChild(li);
  });
}
