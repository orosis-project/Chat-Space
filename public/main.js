// main.js - Chat Space Frontend Logic with Firebase

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
let firebaseAuth = window.firebaseAuth;
let firebaseDb = window.firebaseDb;
let deviceId = null;
let activeModal = null;
let currentBuddyRequestId = null;
const JOIN_CODE = 'HMS';
const OWNER_USERNAME = 'Austin';

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

function showScreen(screen) {
  const screens = [joinScreen, authScreen, verificationScreen, chatScreen, settingsModal, ownerDashboardContainer];
  screens.forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
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
  showScreen(joinScreen);
  
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
  if (code === JOIN_CODE) {
    showScreen(authScreen);
    checkAccountApprovalSetting();
  } else {
    joinError.textContent = 'Invalid join code.';
  }
});

async function checkAccountApprovalSetting() {
    try {
        // Since we're using Firebase, this API call is no longer needed.
        // We'll simulate the setting for now.
        const requiresApproval = false; // Simulating for a simple app.
        if (requiresApproval) {
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
    const userCredential = await firebaseAuth.signInWithEmailAndPassword(username, password);
    user = {
      id: userCredential.user.uid,
      username: username,
      role: 'user',
    };
    
    if (username === OWNER_USERNAME) {
        user.role = 'owner';
    }

    loginSuccess();

  } catch (err) {
    authMessage.textContent = 'Invalid username or password.';
    console.error('Login error:', err);
  }
});

// Registration Form Submission
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = e.target.elements['register-username'].value;
  const password = e.target.elements['register-password'].value;

  try {
    const userCredential = await firebaseAuth.createUserWithEmailAndPassword(username, password);
    const newUser = {
        id: userCredential.user.uid,
        username: username,
        role: 'user',
        is_pending: false,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await firebaseDb.collection('users').doc(newUser.id).set(newUser);
    
    authMessage.textContent = 'Registration successful. Please sign in.';
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    authSubtitle.textContent = 'Please sign in or register.';

  } catch (err) {
    authMessage.textContent = 'Registration failed. ' + err.message;
    console.error('Registration error:', err);
  }
});


// Main Login Success function
function loginSuccess() {
  showScreen(chatScreen);
  
  // Set up real-time listeners for chat messages and online users
  firebaseDb.collection('messages').orderBy('timestamp').onSnapshot(snapshot => {
      messagesContainer.innerHTML = '';
      snapshot.forEach(doc => {
          const message = doc.data();
          showMessage(message.username, message.message, message.timestamp?.toDate(), message.role);
      });
  });
  
  // This is a simple online user list simulation. In a real app, you'd use Firestore presence.
  const onlineUserRef = firebaseDb.collection('onlineUsers').doc(user.id);
  onlineUserRef.set({
      username: user.username,
      role: user.role,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
  });
  
  // Listen for online user updates
  firebaseDb.collection('onlineUsers').onSnapshot(snapshot => {
      onlineUsersList.innerHTML = '';
      snapshot.forEach(doc => {
          const onlineUser = doc.data();
          const li = document.createElement('li');
          li.classList.add('user-item');
          li.innerHTML = `
            <span class="user-status"></span>
            <span class="username">${onlineUser.username}</span>
            <span class="role-badge ${onlineUser.role}">${onlineUser.role}</span>
          `;
          onlineUsersList.appendChild(li);
      });
  });

  if (user.role === 'owner' || user.role === 'co-owner' || user.role === 'manager') {
      setupOwnerDashboard();
  }
}

// --- Chat & Firestore Logic ---
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (message && user) {
    await firebaseDb.collection('messages').add({
      userId: user.id,
      username: user.username,
      message: message,
      role: user.role,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
    messageInput.value = '';
  }
});


// --- Other Functions (Simplified/Simulated) ---

// Giphy Button
giphyButton.addEventListener('click', () => {
  // In a Firebase context, you would need to set up a Firebase Function
  // to securely call the Giphy API, but for now, this is a placeholder.
  alert('Giphy feature needs a Firebase Function backend to work securely.');
});

// Poll Button
pollButton.addEventListener('click', () => {
  alert('Poll feature would be implemented using Firestore collections.');
});

// Settings Button
settingsButton.addEventListener('click', () => {
  alert('Settings page would be implemented here, including 2FA setup.');
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

  // These event listeners and rendering logic would be implemented here
  // using Firestore. For now, they are placeholders.
}
