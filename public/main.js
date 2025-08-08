document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, currentRoom: null, isOwner: false, replyingTo: null, editingId: null };

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
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const userList = document.getElementById('user-list');

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => {
            p.classList.remove('active');
            p.classList.add('hidden');
        });
        pages[pageName].classList.add('active');
        pages[pageName].classList.remove('hidden');
    };

    const checkStoredUser = async () => {
        const storedUser = localStorage.getItem('chat-username');
        if (storedUser) {
            state.username = storedUser;
            welcomeUsername.textContent = state.username;
            await fetchMyRooms();
            showPage('menu');
        } else {
            // Default to login tab on initial load
            setActiveTab(loginTab, signupTab, loginForm, signupForm);
            showPage('auth');
        }
    };

    const fetchMyRooms = async () => {
        try {
            const res = await fetch(`/my-rooms/${state.username}`);
            if (!res.ok) throw new Error('Failed to fetch rooms.');
            const rooms = await res.json();
            myRoomsList.innerHTML = '';
            const noRoomsEl = document.getElementById('no-rooms-message');
            if (rooms.length > 0) {
                if(noRoomsEl) noRoomsEl.style.display = 'none';
                rooms.forEach(roomCode => {
                    const roomBtn = document.createElement('button');
                    roomBtn.className = "w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-lg transition font-semibold";
                    roomBtn.textContent = roomCode;
                    roomBtn.dataset.roomcode = roomCode;
                    myRoomsList.appendChild(roomBtn);
                });
            } else {
                 if(noRoomsEl) {
                    myRoomsList.appendChild(noRoomsEl);
                    noRoomsEl.style.display = 'block';
                 }
            }
        } catch (error) {
            const noRoomsEl = document.getElementById('no-rooms-message');
            if(noRoomsEl) {
                noRoomsEl.textContent = "Could not load your rooms.";
                noRoomsEl.style.display = 'block';
            }
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
            alert(error.message);
        }
    };

    const addMessageToUI = (data) => {
        const { id, username, message, timestamp, edited } = data;
        const isOwnMessage = username === state.username;

        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper flex items-start gap-3 ${isOwnMessage ? 'flex-row-reverse ml-auto' : ''}`;
        wrapper.id = `msg-wrapper-${id}`;

        const avatar = document.createElement('div');
        avatar.className = 'user-avatar w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold';
        avatar.textContent = username.charAt(0).toUpperCase();
        avatar.style.backgroundColor = generateColor(username);

        const messageDiv = document.createElement('div');
        messageDiv.className = `message rounded-lg p-3 max-w-xs md:max-w-md ${isOwnMessage ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`;
        messageDiv.id = `msg-${id}`;
        
        messageDiv.innerHTML = `
            <div class="message-info font-bold mb-1">${username}</div>
            <div class="message-content text-sm">${marked.parse(message || '')}</div>
            <div class="message-meta text-xs mt-2 opacity-70 text-right">${edited ? '(edited) ' : ''}${timestamp}</div>
        `;

        wrapper.appendChild(avatar);
        wrapper.appendChild(messageDiv);
        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const updateUserList = (users) => {
        userList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'flex items-center gap-2 p-2 rounded-md hover:bg-gray-100';
            li.innerHTML = `
                <div class="user-avatar w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold" style="background-color: ${generateColor(user)}">${user.charAt(0).toUpperCase()}</div>
                <span class="font-medium">${user}</span>
            `;
            userList.appendChild(li);
        });
    };

    const generateColor = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
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
            socket.emit('chat-message', {
                roomCode: state.currentRoom,
                message: message,
            });
            messageInput.value = '';
        }
    };

    const setActiveTab = (activeTab, inactiveTab, activeForm, inactiveForm) => {
        activeTab.classList.add('text-blue-600', 'border-blue-600');
        activeTab.classList.remove('border-transparent');
        inactiveTab.classList.remove('text-blue-600', 'border-blue-600');
        inactiveTab.classList.add('border-transparent');
        activeForm.classList.remove('hidden');
        inactiveForm.classList.add('hidden');
    };

    // --- Event Listeners ---
    logoutBtn.addEventListener('click', handleLogout);
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    loginTab.addEventListener('click', () => setActiveTab(loginTab, signupTab, loginForm, signupForm));
    signupTab.addEventListener('click', () => setActiveTab(signupTab, loginTab, signupForm, loginForm));
    createTab.addEventListener('click', () => setActiveTab(createTab, joinTab, createRoomForm, joinRoomForm));
    joinTab.addEventListener('click', () => setActiveTab(joinTab, createTab, joinRoomForm, createRoomForm));
    
    loginForm.addEventListener('submit', (e) => handleAuth(e, '/login'));
    signupForm.addEventListener('submit', (e) => handleAuth(e, '/signup'));
    createRoomForm.addEventListener('submit', handleCreateRoom);
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
        messagesContainer.innerHTML = '';
        if (data.previousMessages) {
            data.previousMessages.forEach(addMessageToUI);
        }
    });

    socket.on('user-list-update', (users) => {
        updateUserList(users);
    });
    
    socket.on('chat-message', (data) => {
        addMessageToUI(data);
    });
});
