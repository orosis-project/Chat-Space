document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Page elements
    const joinPage = document.getElementById('join-page');
    const chatPage = document.getElementById('chat-page');
    const errorMessageDiv = document.getElementById('error-message');

    // Form elements
    const usernameInput = document.getElementById('username-input');
    const roomCodeInput = document.getElementById('room-code-input');
    const passwordInput = document.getElementById('password-input');
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');

    // Chat page elements
    const roomCodeDisplay = document.getElementById('room-code-display');
    const userList = document.getElementById('user-list');
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const emojiBtn = document.getElementById('emoji-btn');
    const imageUpload = document.getElementById('image-upload');
    const notificationSound = document.getElementById('notification-sound');

    let currentRoom = '';
    let username = '';
    let typingTimeout;

    const emojiPicker = new EmojiButton({ position: 'top-start' });
    emojiPicker.on('emoji', emoji => {
        messageInput.value += emoji;
    });

    // --- Event Listeners ---
    createRoomBtn.addEventListener('click', handleCreateRoom);
    joinRoomBtn.addEventListener('click', handleJoinRoom);
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => e.key === 'Enter' && sendMessage());
    messageInput.addEventListener('input', handleTyping);
    leaveRoomBtn.addEventListener('click', () => window.location.reload());
    emojiBtn.addEventListener('click', () => emojiPicker.togglePicker(emojiBtn));
    imageUpload.addEventListener('change', handleImageUpload);

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => console.log('Connected to server'));
    socket.on('previous-messages', messages => messages.forEach(addMessageToUI));
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('chat-message', addMessageToUI);
    socket.on('image-message', addMessageToUI);
    socket.on('typing', updateTypingIndicator);
    socket.on('error', (errorMessage) => {
        showError(errorMessage);
        showJoinPage();
    });

    // --- Core Functions ---
    async function handleCreateRoom() {
        const roomData = getFormData();
        if (!roomData) return;

        try {
            const response = await fetch('/create-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(roomData)
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message);
            }
            // After creating, automatically join
            handleJoinRoom();
        } catch (error) {
            showError(error.message);
        }
    }

    async function handleJoinRoom() {
        const roomData = getFormData();
        if (!roomData) return;

        try {
            const response = await fetch('/login-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(roomData)
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message);
            }
            // On successful login, join the socket room
            username = roomData.username;
            currentRoom = roomData.roomCode;
            socket.emit('join-room', { roomCode: currentRoom, username });
            showChatPage();
            requestNotificationPermission();
        } catch (error) {
            showError(error.message);
        }
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

    function handleTyping() {
        socket.emit('typing', currentRoom);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => socket.emit('stop-typing', currentRoom), 2000);
    }
    
    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                socket.emit('image-message', { roomCode: currentRoom, image: event.target.result });
            };
            reader.readAsDataURL(file);
        }
    }

    // --- UI & Helper Functions ---
    function getFormData() {
        const username = usernameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !roomCode || !password) {
            showError('All fields are required.');
            return null;
        }
        return { username, roomCode, password };
    }

    function showError(message) {
        errorMessageDiv.textContent = message;
        setTimeout(() => errorMessageDiv.textContent = '', 3000);
    }

    function showChatPage() {
        joinPage.classList.remove('active');
        chatPage.classList.add('active');
        roomCodeDisplay.textContent = currentRoom;
    }

    function showJoinPage() {
        chatPage.classList.remove('active');
        joinPage.classList.add('active');
    }

    function addMessageToUI(data) {
        const isOwnMessage = data.username === username;
        if (!document.hasFocus() && !isOwnMessage) {
            playNotificationSound();
            showNotification(`New message from ${data.username}`);
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', isOwnMessage ? 'own' : 'other');

        let content;
        if (data.image) {
            content = `<div class="image-container"><img src="${data.image}" alt="User image"></div>`;
        } else {
            content = `<div class="text">${data.message}</div>`;
        }
        
        messageElement.innerHTML = `
            <div class="info">
                <span class="username">${data.username}</span>
                <span class="timestamp">${data.timestamp}</span>
            </div>
            ${content}
        `;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        updateTypingIndicator([]);
    }

    function displayNotification(text) {
        const notificationElement = document.createElement('div');
        notificationElement.classList.add('notification');
        notificationElement.textContent = text;
        messagesContainer.appendChild(notificationElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function updateUserList(users) {
        userList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user;
            userList.appendChild(li);
        });
    }
    
    function handleUserJoined({ username: joinedUsername, userList }) {
        displayNotification(`${joinedUsername} has joined the room.`);
        updateUserList(userList);
    }

    function handleUserLeft({ username: leftUsername, userList }) {
        displayNotification(`${leftUsername} has left the room.`);
        updateUserList(userList);
    }

    function updateTypingIndicator(typingUsers) {
        const otherTypingUsers = typingUsers.filter(u => u !== username);
        if (otherTypingUsers.length === 0) {
            typingIndicator.textContent = '';
        } else if (otherTypingUsers.length <= 2) {
            typingIndicator.textContent = `${otherTypingUsers.join(' and ')} is typing...`;
        } else {
            typingIndicator.textContent = 'Several people are typing...';
        }
    }

    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
    }

    function showNotification(body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('New Message', { body });
        }
    }
    
    function playNotificationSound() {
        notificationSound.play().catch(e => console.error("Error playing sound:", e));
    }
});
