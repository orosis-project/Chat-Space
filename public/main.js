document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, role: null };

    // --- Element Selectors ---
    const pages = {
        joinCode: document.getElementById('join-code-page'),
        login: document.getElementById('login-page'),
        chat: document.getElementById('chat-page'),
    };

    // --- Form Selectors ---
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const joinError = document.getElementById('join-error');
    const loginError = document.getElementById('login-error');
    
    // Chat Page Elements
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const userList = document.getElementById('user-list');
    const leaveRoomBtn = document.getElementById('leave-room-btn');


    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => {
            p.classList.remove('active');
            p.classList.add('hidden');
        });
        pages[pageName].classList.add('active');
        pages[pageName].classList.remove('hidden');
    };

    const handleJoinCode = async (e) => {
        e.preventDefault();
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            const response = await fetch('/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            showPage('login');
        } catch (error) {
            joinError.textContent = error.message;
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            
            state.username = data.username;
            state.role = data.role;
            socket.emit('user-connect', { username: state.username, role: state.role });
        } catch (error) {
            loginError.textContent = error.message;
        }
    };

    const addMessageToUI = (data) => {
        const { username, message, timestamp } = data;
        const isOwnMessage = username === state.username;
        const wrapper = document.createElement('div');
        wrapper.className = `flex items-start gap-3 ${isOwnMessage ? 'flex-row-reverse ml-auto' : ''}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold';
        avatar.textContent = username.charAt(0).toUpperCase();
        avatar.style.backgroundColor = generateColor(username);

        const messageDiv = document.createElement('div');
        messageDiv.className = `rounded-lg p-3 max-w-xs md:max-w-md ${isOwnMessage ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`;
        messageDiv.innerHTML = `<div class="font-bold mb-1">${username}</div><div class="text-sm">${marked.parse(message || '')}</div><div class="text-xs mt-2 opacity-70 text-right">${timestamp}</div>`;

        wrapper.appendChild(avatar);
        wrapper.appendChild(messageDiv);
        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const updateUserList = (users) => {
        userList.innerHTML = '';
        for (const username in users) {
            const role = users[username];
            const li = document.createElement('li');
            li.className = 'flex items-center gap-2 p-2 rounded-md hover:bg-gray-100';
            li.innerHTML = `
                <div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold" style="background-color: ${generateColor(username)}">${username.charAt(0).toUpperCase()}</div>
                <div>
                    <span class="font-medium">${username}</span>
                    <span class="text-xs text-gray-500 block">${role}</span>
                </div>
            `;
            userList.appendChild(li);
        }
    };

    const generateColor = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        let color = '#';
        for (let i = 0; i < 3; i++) {
            let value = (hash >> (i * 8)) & 0xFF;
            color += ('00' + value.toString(16)).substr(-2);
        }
        return color;
    };

    const sendMessage = () => {
        const message = messageInput.value.trim();
        if (message) {
            socket.emit('chat-message', { message });
            messageInput.value = '';
        }
    };
    
    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    leaveRoomBtn.addEventListener('click', () => window.location.reload());

    // --- Socket Handlers ---
    socket.on('join-successful', ({ messages, settings }) => {
        showPage('chat');
        messagesContainer.innerHTML = '';
        messages.forEach(addMessageToUI);
    });

    socket.on('waiting-for-approval', () => {
        const chatPage = document.getElementById('chat-page');
        chatPage.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center text-center p-8"><h2 class="text-2xl font-bold">Waiting for Approval</h2><p class="text-gray-600 mt-2">An admin or moderator has been notified of your request to join.</p></div>`;
        showPage('chat');
    });

    socket.on('user-list-update', (users) => {
        updateUserList(users);
    });

    socket.on('chat-message', (data) => {
        addMessageToUI(data);
    });

    socket.on('error', (message) => {
        alert(`Server Error: ${message}`);
    });

    // Initialize the first page
    showPage('joinCode');
});
