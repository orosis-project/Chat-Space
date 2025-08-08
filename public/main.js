document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Connect to the server

    // Page elements
    const joinPage = document.getElementById('join-page');
    const chatPage = document.getElementById('chat-page');

    // Join page elements
    const usernameInput = document.getElementById('username-input');
    const createRoomBtn = document.getElementById('create-room-btn');
    const roomCodeInput = document.getElementById('room-code-input');
    const joinRoomBtn = document.getElementById('join-room-btn');

    // Chat page elements
    const roomCodeDisplay = document.getElementById('room-code-display');
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const typingIndicator = document.getElementById('typing-indicator');

    let currentRoom = '';
    let username = '';
    let typingTimeout;

    // --- Event Listeners ---

    createRoomBtn.addEventListener('click', async () => {
        username = usernameInput.value.trim();
        if (!username) {
            alert('Please enter a username.');
            return;
        }

        try {
            const response = await fetch('/create-room', { method: 'POST' });
            const data = await response.json();
            currentRoom = data.roomCode;
            socket.emit('set-username', username);
            socket.emit('join-room', currentRoom);
            showChatPage();
        } catch (error) {
            console.error('Error creating room:', error);
            alert('Could not create a room. Please try again.');
        }
    });

    joinRoomBtn.addEventListener('click', () => {
        username = usernameInput.value.trim();
        currentRoom = roomCodeInput.value.trim();
        if (!username || !currentRoom) {
            alert('Please enter a username and room code.');
            return;
        }
        socket.emit('set-username', username);
        socket.emit('join-room', currentRoom);
    });

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    messageInput.addEventListener('input', () => {
        socket.emit('typing', { roomCode: currentRoom });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stop-typing', currentRoom);
        }, 2000);
    });

    leaveRoomBtn.addEventListener('click', () => {
        window.location.reload();
    });

    // --- Socket.IO Event Handlers ---

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('previous-messages', (messages) => {
        messages.forEach(msg => displayMessage(msg));
    });

    socket.on('user-joined', (notification) => {
        displayNotification(notification);
    });

    socket.on('chat-message', (data) => {
        displayMessage(data);
    });

    socket.on('user-left', (notification) => {
        displayNotification(notification);
    });
    
    socket.on('typing', (message) => {
        typingIndicator.textContent = message;
    });

    socket.on('stop-typing', () => {
        typingIndicator.textContent = '';
    });

    socket.on('error', (errorMessage) => {
        alert(errorMessage);
        showJoinPage();
    });

    // --- Helper Functions ---

    function showChatPage() {
        joinPage.classList.remove('active');
        chatPage.classList.add('active');
        roomCodeDisplay.textContent = currentRoom;
    }

    function showJoinPage() {
        chatPage.classList.remove('active');
        joinPage.classList.add('active');
        currentRoom = '';
        roomCodeDisplay.textContent = '';
        messagesContainer.innerHTML = '';
    }

    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && currentRoom) {
            socket.emit('chat-message', { roomCode: currentRoom, message });
            messageInput.value = '';
            clearTimeout(typingTimeout);
            socket.emit('stop-typing', currentRoom);
        }
    }

    function displayMessage(data) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');

        if (data.username === username) {
            messageElement.classList.add('own');
        }

        messageElement.innerHTML = `
            <div class="username">${data.username}</div>
            <div class="text">${data.message}</div>
        `;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        typingIndicator.textContent = '';
    }

    function displayNotification(notification) {
        const notificationElement = document.createElement('div');
        notificationElement.classList.add('notification');
        notificationElement.textContent = notification;
        messagesContainer.appendChild(notificationElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});
