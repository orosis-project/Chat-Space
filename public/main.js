document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let state = { username: null, currentRoom: null, isOwner: false };

    // --- Element Selectors ---
    const pages = { auth: document.getElementById('auth-page'), menu: document.getElementById('menu-page'), chat: document.getElementById('chat-page') };
    const welcomeUsername = document.getElementById('welcome-username');
    const logoutBtn = document.getElementById('logout-btn');
    const myRoomsList = document.getElementById('my-rooms-list');
    const noRoomsMessage = document.getElementById('no-rooms-message');
    const joinRoomModal = document.getElementById('join-room-modal');
    const modalRoomCode = document.getElementById('modal-room-code');
    const modalJoinForm = document.getElementById('modal-join-form');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => p.classList.add('hidden'));
        pages[pageName].classList.remove('hidden', 'items-center', 'justify-center');
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
            const rooms = await res.json();
            myRoomsList.innerHTML = '';
            if (rooms.length > 0) {
                noRoomsMessage.style.display = 'none';
                rooms.forEach(roomCode => {
                    const roomBtn = document.createElement('button');
                    roomBtn.className = "w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-lg transition";
                    roomBtn.textContent = roomCode;
                    roomBtn.dataset.roomcode = roomCode;
                    myRoomsList.appendChild(roomBtn);
                });
            } else {
                myRoomsList.appendChild(noRoomsMessage);
                noRoomsMessage.style.display = 'block';
            }
        } catch (error) {
            console.error("Could not fetch user's rooms");
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

    // --- Event Listeners ---
    logoutBtn.addEventListener('click', handleLogout);

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
    });

    modalJoinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomCode = modalRoomCode.textContent;
        const password = document.getElementById('modal-room-password').value;
        // Re-use the existing handleJoinRoom logic
        handleJoinRoom(e, roomCode, password);
    });

    // Initial check when the app loads
    checkStoredUser();
    
    // All other event listeners (login, signup, create room, etc.)
    // and socket handlers remain the same as the previous correct version.
    // ...
});
