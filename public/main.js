document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, role: null, currentChannel: 'general', activeDM: null };

    // --- Element Selectors ---
    const pages = {
        joinCode: document.getElementById('join-code-page'),
        login: document.getElementById('login-page'),
        chat: document.getElementById('chat-page'),
    };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const joinError = document.getElementById('join-error');
    const loginError = document.getElementById('login-error');

    // --- Core Functions ---
    const showPage = (pageName) => {
        // This function correctly switches between pages
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
            // This assumes a server endpoint '/join' exists
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
            // This assumes a server endpoint '/login' exists
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
            showPage('chat');
        } catch (error) {
            loginError.textContent = error.message;
        }
    };

    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);

    // --- Socket Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('error', (message) => {
        alert(`Server Error: ${message}`);
    });
    
    // In a full app, more socket handlers for messages, user lists etc. would go here

    // --- Initial Load ---
    // This ensures the first page is always shown correctly.
    showPage('joinCode');
});
