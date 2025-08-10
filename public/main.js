document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, role: null, currentChannel: 'general', activeDM: null };

    // --- Element Selectors ---
    const pages = {
        joinCode: document.getElementById('join-code-page'),
        login: document.getElementById('login-page'),
        chat: document.getElementById('chat-page'),
    };
    const settingsModal = document.getElementById('settings-modal');
    const pollModal = document.getElementById('poll-modal');
    const createPollBtn = document.getElementById('create-poll-btn');
    const addPollOptionBtn = document.getElementById('add-poll-option-btn');
    const pollForm = document.getElementById('poll-form');
    const setBackgroundBtn = document.getElementById('set-background-btn');
    const chatBackground = document.getElementById('chat-background');
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const joinError = document.getElementById('join-error');
    const loginError = document.getElementById('login-error');

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
    
    const handleCreatePoll = (e) => {
        e.preventDefault();
        const question = document.getElementById('poll-question').value;
        const options = Array.from(document.querySelectorAll('input[name="poll-option"]'))
                             .map(input => input.value.trim())
                             .filter(Boolean);
        if (question && options.length >= 2) {
            socket.emit('create-poll', { channel: state.currentChannel, question, options });
            pollModal.classList.add('hidden');
            pollForm.reset();
        }
    };

    const handleSetBackground = () => {
        const url = document.getElementById('background-url-input').value;
        socket.emit('set-background', { url });
    };

    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);
    createPollBtn.addEventListener('click', () => pollModal.classList.remove('hidden'));
    addPollOptionBtn.addEventListener('click', () => {
        const container = document.getElementById('poll-options-container');
        const input = document.createElement('input');
        input.type = 'text';
        input.name = 'poll-option';
        input.placeholder = `Option ${container.children.length + 1}`;
        input.className = 'w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg';
        container.appendChild(input);
    });
    pollForm.addEventListener('submit', handleCreatePoll);
    setBackgroundBtn.addEventListener('click', handleSetBackground);

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        showPage('chat');
        if (data.settings.backgroundUrl) {
            chatBackground.style.backgroundImage = `url(${data.settings.backgroundUrl})`;
        }
    });

    socket.on('background-updated', (url) => {
        chatBackground.style.backgroundImage = `url(${url})`;
    });

    // --- Initial Load ---
    showPage('joinCode');
});
