document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, role: null };

    // --- Element Selectors ---
    const pages = {
        joinCode: document.getElementById('join-code-page'),
        login: document.getElementById('login-page'),
        chat: document.getElementById('chat-page'),
    };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const joinError = document.getElementById('join-error');
    const loginError = document.getElementById('login-error');
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => {
            p.classList.remove('active');
            p.classList.add('hidden');
        });
        pages[pageName].classList.add('active');
        pages[pageName].classList.remove('hidden');
    };

    const setActiveTab = (activeTab, inactiveTab, activeForm, inactiveForm) => {
        activeTab.classList.add('text-blue-600', 'border-blue-600');
        activeTab.classList.remove('border-transparent');
        inactiveTab.classList.remove('text-blue-600', 'border-blue-600');
        inactiveTab.classList.add('border-transparent');
        activeForm.classList.remove('hidden');
        inactiveForm.classList.add('hidden');
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

    const handleAuth = async (e, endpoint) => {
        e.preventDefault();
        loginError.textContent = '';
        const form = e.target;
        const username = form.querySelector('input[type="text"]').value;
        const password = form.querySelector('input[type="password"]').value;
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            
            if (endpoint === '/signup') {
                alert('Signup successful! Please log in.');
                loginTab.click();
                form.reset();
            } else {
                state.username = data.username;
                state.role = data.role;
                socket.emit('user-connect', { username: state.username, role: state.role });
            }
        } catch (error) {
            loginError.textContent = error.message;
        }
    };
    
    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', (e) => handleAuth(e, '/login'));
    signupForm.addEventListener('submit', (e) => handleAuth(e, '/signup'));

    loginTab.addEventListener('click', () => setActiveTab(loginTab, signupTab, loginForm, signupForm));
    signupTab.addEventListener('click', () => setActiveTab(signupTab, loginTab, signupForm, loginForm));

    // --- Socket Handlers ---
    socket.on('join-successful', ({ messages, settings }) => {
        // This is where the chat UI would be rendered
        const chatPage = document.getElementById('chat-page');
        chatPage.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center text-center p-8"><h2 class="text-2xl font-bold">Welcome, ${state.username}!</h2><p class="text-gray-600 mt-2">Your role is ${state.role}. Chat is loading...</p></div>`;
        showPage('chat');
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
    setActiveTab(loginTab, signupTab, loginForm, signupForm);
    showPage('joinCode');
});
