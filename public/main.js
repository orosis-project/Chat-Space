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
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const typingIndicatorToggle = document.getElementById('typing-indicator-toggle');
    const imageUpload = document.getElementById('image-upload');
    const giphyBtn = document.getElementById('giphy-btn');
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
    
    const renderChatUI = () => {
        showPage('chat');
    };

    const applyTheme = (isDark) => {
        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    };

    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);

    document.getElementById('settings-btn').addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        settingsModal.classList.add('flex');
    });
    document.getElementById('close-settings-btn').addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        settingsModal.classList.remove('flex');
    });
    darkModeToggle.addEventListener('change', (e) => {
        applyTheme(e.target.checked);
        localStorage.setItem('darkMode', e.target.checked);
    });

    // --- Socket Handlers ---
    socket.on('join-successful', ({ messages, settings }) => {
        renderChatUI();
        document.getElementById('approval-toggle').checked = settings.approvalRequired;
        if (state.role === 'Owner') {
            document.getElementById('owner-settings').style.display = 'block';
        }
    });

    socket.on('waiting-for-approval', () => {
        const chatPage = document.getElementById('chat-page');
        chatPage.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center text-center p-8"><h2 class="text-2xl font-bold">Waiting for Approval</h2><p class="text-gray-600 mt-2">An admin or moderator has been notified of your request to join.</p></div>`;
        showPage('chat');
    });

    socket.on('error', (message) => {
        alert(`Server Error: ${message}`);
    });

    // --- Initial Load ---
    const savedTheme = localStorage.getItem('darkMode') === 'true';
    darkModeToggle.checked = savedTheme;
    applyTheme(savedTheme);
    showPage('joinCode');
});
