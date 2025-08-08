document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, currentRoom: null, isOwner: false };

    // --- Element Selectors ---
    const pages = { auth: document.getElementById('auth-page'), menu: document.getElementById('menu-page'), chat: document.getElementById('chat-page') };
    const authError = document.getElementById('auth-error');
    const menuError = document.getElementById('menu-error');
    
    // Auth Page
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    // Menu Page
    const welcomeUsername = document.getElementById('welcome-username');
    const logoutBtn = document.getElementById('logout-btn');
    const myRoomsList = document.getElementById('my-rooms-list');
    const noRoomsMessage = document.getElementById('no-rooms-message');
    const createTab = document.getElementById('create-tab');
    const joinTab = document.getElementById('join-tab');
    const createRoomForm = document.getElementById('create-room-form');
    const joinRoomForm = document.getElementById('join-room-form');

    // Join Modal
    const joinRoomModal = document.getElementById('join-room-modal');
    const modalRoomCode = document.getElementById('modal-room-code');
    const modalJoinForm = document.getElementById('modal-join-form');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    
    // Chat Page
    const roomCodeDisplay = document.getElementById('room-code-display');
    const settingsBtn = document.getElementById('settings-btn');

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => {
            p.classList.add('hidden');
            p.classList.remove('flex');
        });
        pages[pageName].classList.remove('hidden');
        pages[pageName].classList.add('flex');
        if (pageName === 'auth' || pageName === 'menu') {
            pages[pageName].classList.add('items-center', 'justify-center');
        }
    };

    const checkStoredUser = async () => {
        const storedUser = localStorage.getItem('chat-username');
        if (storedUser) {
            state.username = storedUser;
            welcomeUsername.textContent = state.username;
            await fetchMyRooms();
            showPage('menu');
        } else {
            showPage('auth');
        }
    };

    const fetchMyRooms = async () => {
        try {
            const res = await fetch(`/my-rooms/${state.username}`);
            if (!res.ok) throw new Error('Failed to fetch rooms.');
            const rooms = await res.json();
            myRoomsList.innerHTML = ''; // Clear previous list
            if (rooms.length > 0) {
                noRoomsMessage.style.display = 'none';
                rooms.forEach(roomCode => {
                    const roomBtn = document.createElement('button');
                    roomBtn.className = "w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-lg transition font-semibold";
                    roomBtn.textContent = roomCode;
                    roomBtn.dataset.roomcode = roomCode;
                    myRoomsList.appendChild(roomBtn);
                });
            } else {
                myRoomsList.appendChild(noRoomsMessage);
                noRoomsMessage.style.display = 'block';
            }
        } catch (error) {
            console.error("Could not fetch user's rooms:", error);
            noRoomsMessage.textContent = "Could not load your rooms.";
            noRoomsMessage.style.display = 'block';
        }
    };
    
    const handleLoginSuccess = async (username) => {
        localStorage.setItem('chat-username', username);
        state.username = username;
        welcomeUsername.textContent = username;
        await fetchMyRooms();
        showPage('menu');
    };

    const handleLogout = () => {
        localStorage.removeItem('chat-username');
        state = { username: null, currentRoom: null, isOwner: false };
        window.location.reload();
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
                handleLoginSuccess(username);
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
            await handleJoinRoom(e, roomCode, password);
        } catch (error) {
            menuError.textContent = error.message;
        }
    };

    const handleJoinRoom = async (e, code, pass) => {
        if(e) e.preventDefault();
        menuError.textContent = '';
        const roomCode = code;
        const password = pass;
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
        } catch (error) {
            menuError.textContent = error.message;
            alert(error.message); // Also alert for modal
        }
    };


    // --- Event Listeners ---
    logoutBtn.addEventListener('click', handleLogout);

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
    // Join form is handled by the modal now

    myRoomsList.addEventListener('click', (e) => {
        if (e.target.dataset.roomcode) {
            const roomCode = e.target.dataset.roomcode;
            modalRoomCode.textContent = roomCode;
            joinRoomModal.classList.remove('hidden');
            joinRoomModal.classList.add('flex');
        }
    });
    
    modalCancelBtn.addEventListener('click', () => {
        joinRoomModal.classList.add('hidden');
        joinRoomModal.classList.remove('flex');
        modalJoinForm.reset();
    });

    modalJoinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomCode = modalRoomCode.textContent;
        const password = document.getElementById('modal-room-password').value;
        handleJoinRoom(null, roomCode, password);
        modalJoinForm.reset();
        joinRoomModal.classList.add('hidden');
        joinRoomModal.classList.remove('flex');
    });

    // Initial check when the app loads
    checkStoredUser();
    
    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        showPage('chat');
        roomCodeDisplay.textContent = state.currentRoom;
        if (state.isOwner) {
            settingsBtn.style.display = 'block';
        }
        // Initialize chat UI, clear old messages, etc.
        document.getElementById('messages').innerHTML = '';
        data.previousMessages.forEach(msg => { /* function to add message to UI */ });
    });

    socket.on('user-list-update', (users) => {
        // function to update the user list UI
    });
    
    // All other socket handlers for chat functionality would be here
});
