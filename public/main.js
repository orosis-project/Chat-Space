document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, role: null };

    // --- Page Selectors ---
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

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => p.classList.add('hidden'));
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
            showPage('chat');
        } catch (error) {
            loginError.textContent = error.message;
        }
    };
    
    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);

    // --- Socket Handlers ---
    socket.on('join-successful', ({ messages, settings }) => {
        // Render the chat UI inside the chat page
        const chatPage = document.getElementById('chat-page');
        // This is where you would build the chat interface dynamically
        chatPage.innerHTML = `<div>Welcome ${state.username}! Your role is ${state.role}.</div>`;
        // In a full implementation, you'd render the sidebar, message window, etc.
    });

    socket.on('waiting-for-approval', () => {
        const chatPage = document.getElementById('chat-page');
        chatPage.innerHTML = `<div class="text-center p-8"><h2>Waiting for Approval</h2><p>An admin has been notified.</p></div>`;
        showPage('chat');
    });

    socket.on('error', (message) => {
        alert(`Server Error: ${message}`);
    });

    // Initialize the first page
    showPage('joinCode');
});
