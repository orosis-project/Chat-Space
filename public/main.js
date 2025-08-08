document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, currentRoom: null, isOwner: false };

    // --- Page Selectors ---
    const pages = {
        auth: document.getElementById('auth-page'),
        menu: document.getElementById('menu-page'),
        chat: document.getElementById('chat-page'),
    };

    // --- Auth Page Elements ---
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const authError = document.getElementById('auth-error');

    // --- Menu Page Elements ---
    const menuError = document.getElementById('menu-error');
    const createTab = document.getElementById('create-tab');
    const joinTab = document.getElementById('join-tab');
    const createRoomForm = document.getElementById('create-room-form');
    const joinRoomForm = document.getElementById('join-room-form');

    // --- Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => p.classList.add('hidden'));
        pages[pageName].classList.remove('hidden');
    };

    const handleAuth = async (e, endpoint) => {
        e.preventDefault();
        authError.textContent = '';
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
                state.username = username;
                document.getElementById('welcome-username').textContent = username;
                showPage('menu');
            }
        } catch (error) {
            authError.textContent = error.message;
        }
    };

    const handleCreateRoom = async (e) => {
        e.preventDefault();
        menuError.textContent = '';
        const roomCode = document.getElementById('create-room-code').value;
        const password = document.getElementById('create-room-password').value;
        try {
            const res = await fetch('/create-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomCode, username: state.username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            // After creating, automatically attempt to join
            await handleJoinRoom(e, roomCode, password);
        } catch (error) {
            menuError.textContent = error.message;
        }
    };

    const handleJoinRoom = async (e, code, pass) => {
        e.preventDefault();
        menuError.textContent = '';
        const roomCode = code || document.getElementById('join-room-code').value;
        const password = pass || document.getElementById('join-room-password').value;
        try {
            const res = await fetch('/login-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomCode, username: state.username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            
            state.currentRoom = roomCode;
            state.isOwner = data.isOwner;
            socket.emit('join-request', { roomCode, username: state.username });
            // The 'join-successful' event from the server will trigger the page switch
        } catch (error) {
            menuError.textContent = error.message;
        }
    };

    // --- Event Listeners ---
    // FIX: Added tab switching logic
    loginTab.addEventListener('click', () => {
        loginTab.classList.add('text-blue-600', 'border-blue-600');
        loginTab.classList.remove('border-transparent');
        signupTab.classList.remove('text-blue-600', 'border-blue-600');
        signupTab.classList.add('border-transparent');
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
    });

    signupTab.addEventListener('click', () => {
        signupTab.classList.add('text-blue-600', 'border-blue-600');
        signupTab.classList.remove('border-transparent');
        loginTab.classList.remove('text-blue-600', 'border-blue-600');
        loginTab.classList.add('border-transparent');
        signupForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    });

    createTab.addEventListener('click', () => {
        createTab.classList.add('text-blue-600', 'border-blue-600');
        createTab.classList.remove('border-transparent');
        joinTab.classList.remove('text-blue-600', 'border-blue-600');
        joinTab.classList.add('border-transparent');
        createRoomForm.classList.remove('hidden');
        joinRoomForm.classList.add('hidden');
    });

    joinTab.addEventListener('click', () => {
        joinTab.classList.add('text-blue-600', 'border-blue-600');
        joinTab.classList.remove('border-transparent');
        createTab.classList.remove('text-blue-600', 'border-blue-600');
        createTab.classList.add('border-transparent');
        joinRoomForm.classList.remove('hidden');
        createRoomForm.classList.add('hidden');
    });

    loginForm.addEventListener('submit', (e) => handleAuth(e, '/login'));
    signupForm.addEventListener('submit', (e) => handleAuth(e, '/signup'));
    createRoomForm.addEventListener('submit', handleCreateRoom);
    joinRoomForm.addEventListener('submit', handleJoinRoom);

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        showPage('chat');
        // Initialize chat UI logic here
        // For example:
        document.getElementById('room-code-display').textContent = state.currentRoom;
        if (state.isOwner) {
            document.getElementById('settings-btn').style.display = 'block';
        }
        // ... and so on for messages, user lists, etc.
    });

    // All other socket listeners and chat UI logic would go here
});
