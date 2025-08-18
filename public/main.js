document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ autoConnect: false });
    let currentUser = null;
    let notificationEnabled = false;

    // --- DOM Elements ---
    const screens = {
        auth: document.getElementById('auth-screen'),
        pending: document.getElementById('pending-screen'),
        chat: document.getElementById('chat-screen')
    };
    const settingsModal = document.getElementById('settings-modal');
    const ownerModal = document.getElementById('owner-modal');

    // --- UI Functions ---
    const showScreen = (screenName) => Object.values(screens).forEach(s => s.style.display = (s.id === `${screenName}-screen` ? 'flex' : 'none'));

    const setupTabs = () => {
        document.querySelectorAll('.tab-link').forEach(button => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                document.querySelectorAll('.auth-content').forEach(content => {
                    content.classList.toggle('active', content.id === button.dataset.tab);
                });
            });
        });
    };

    const displayMessage = (data) => {
        const messagesContainer = document.getElementById('messages');
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        msgDiv.innerHTML = `<img src="${data.icon_url || '/assets/default-icon.png'}" class="user-icon"><div><strong>${data.user}</strong>: ${data.text}</div>`;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (notificationEnabled && document.hidden && data.user !== currentUser.username) {
            new Notification(data.user, { body: data.text, icon: data.icon_url });
        }
    };

    // --- API Calls ---
    const apiPost = async (endpoint, body) => {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return res.json();
    };

    // --- Event Listeners ---
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const result = await apiPost('/api/register', { username, password });
        if (result.success && result.status === 'pending') {
            showScreen('pending');
            socket.connect();
        } else if (result.success) {
            alert('Registration successful! Please log in.');
        }
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const result = await apiPost('/api/login', { username, password });
        if (result.success) {
            currentUser = result.user;
            document.getElementById('my-username').innerText = currentUser.username;
            document.getElementById('my-icon').src = currentUser.icon_url;
            if (currentUser.role === 'Owner') document.getElementById('owner-panel-btn').style.display = 'block';
            showScreen('chat');
            socket.connect();
        } else {
            document.getElementById('login-error').innerText = result.message || (result.status === 'pending' ? 'Account is pending approval.' : 'Login failed.');
        }
    });
    
    document.getElementById('message-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('message-input');
        if (input.value) {
            socket.emit('chat_message', input.value);
            input.value = '';
        }
    });
    
    // --- Initial Setup ---
    setupTabs();
    fetch('/api/settings').then(res => res.json()).then(settings => {
        if (settings.chatBackground) {
            document.getElementById('chat-screen').style.backgroundImage = `url(${settings.chatBackground})`;
        }
    });

    // --- Socket.IO Handlers ---
    socket.on('account_status_update', ({ status }) => {
        if (status === 'active') {
            alert('Your account has been approved! Please log in.');
            window.location.reload();
        } else if (status === 'denied') {
            alert('Your account has been denied.');
            window.location.reload();
        }
    });
    socket.on('chat_message', displayMessage);
});
