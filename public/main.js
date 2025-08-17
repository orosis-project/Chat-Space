document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let currentUser = null;

    // --- Page Selectors ---
    const pages = {
        auth: document.getElementById('auth-page'),
        pending: document.getElementById('pending-page'),
        chat: document.getElementById('chat-page')
    };

    // --- Auth UI Selectors ---
    const requestBanner = document.getElementById('request-banner');
    const loginTabBtn = document.getElementById('login-tab-btn');
    const registerTabBtn = document.getElementById('register-tab-btn');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginError = document.getElementById('auth-error'); // Shared error display

    // --- Initial Setup ---
    async function initializeAuthUI() {
        try {
            const res = await fetch('/api/auth-info');
            const data = await res.json();
            if (data.approvalRequired) {
                requestBanner.classList.remove('hidden');
                registerTabBtn.classList.remove('hidden');
            } else {
                requestBanner.classList.add('hidden');
                // When approval is not required, registration is open to all
                registerTabBtn.classList.remove('hidden');
                registerTabBtn.textContent = 'Sign Up';
            }
        } catch (error) {
            console.error("Could not fetch auth info:", error);
            // Default to showing login only if server fails
            registerTabBtn.classList.add('hidden');
        }
    }
    initializeAuthUI();

    // --- Tab Switching Logic ---
    loginTabBtn.addEventListener('click', () => {
        loginTabBtn.classList.add('active');
        registerTabBtn.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginError.textContent = '';
    });
    registerTabBtn.addEventListener('click', () => {
        registerTabBtn.classList.add('active');
        loginTabBtn.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        loginError.textContent = '';
    });

    // --- Page Navigation ---
    function switchPage(pageName) {
        Object.values(pages).forEach(page => page.classList.add('hidden'));
        pages[pageName].classList.remove('hidden');
        pages[pageName].classList.add('active');
    }

    // --- Registration Handler ---
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            if (data.status === 'pending') {
                socket.emit('join-pending-room', username);
                switchPage('pending');
            } else {
                showToast('Account created! Please sign in.', 'success');
                loginTabBtn.click(); // Switch to login tab
            }
        } catch (error) {
            loginError.textContent = error.message;
        }
    });

    // --- Login Handler ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            onLoginSuccess(data.user);
        } catch (error) {
            loginError.textContent = error.message;
        }
    });

    function onLoginSuccess(user) {
        currentUser = user;
        switchPage('chat');
    }

    // --- Socket Listeners for Account Status ---
    socket.on('account-approved', (data) => {
        const pendingNotification = document.getElementById('pending-notification');
        if(pendingNotification) {
            pendingNotification.textContent = data.message;
            pendingNotification.className = 'mt-4 font-semibold text-green-500';
            setTimeout(() => window.location.reload(), 4000);
        }
    });
    socket.on('account-denied', (data) => {
        const pendingNotification = document.getElementById('pending-notification');
        if(pendingNotification) {
            pendingNotification.textContent = data.message;
            pendingNotification.className = 'mt-4 font-semibold text-red-500';
        }
    });

    // --- UI Helper: Toast Notification ---
    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }
});
