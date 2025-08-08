document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- State Management ---
    let state = {
        username: '',
        currentRoom: '',
        isOwner: false,
        replyingTo: null, // { id, username }
        editingId: null,
    };

    // --- Element Selectors ---
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const userList = document.getElementById('user-list');
    const replyPreview = document.getElementById('reply-preview');
    const editModal = document.getElementById('edit-modal');
    
    // --- Core Functions ---
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            socket.emit('chat-message', {
                roomCode: state.currentRoom,
                message,
                replyTo: state.replyingTo
            });
            messageInput.value = '';
            cancelReply();
        }
    }

    function addMessageToUI(data) {
        const { id, username, message, timestamp, replyTo, edited } = data;
        const isOwnMessage = username === state.username;

        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isOwnMessage ? 'own' : ''}`;
        wrapper.id = `msg-wrapper-${id}`;

        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.textContent = username.charAt(0).toUpperCase();
        avatar.style.backgroundColor = generateColor(username);

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwnMessage ? 'own' : ''}`;
        messageDiv.id = `msg-${id}`;

        let replyHTML = '';
        if (replyTo) {
            const originalMsg = document.querySelector(`#msg-${replyTo.id} .message-content`);
            const originalText = originalMsg ? originalMsg.textContent.substring(0, 40) + '...' : 'Original message';
            replyHTML = `<div class="reply-quote"><strong>${replyTo.username}</strong>: ${originalText}</div>`;
        }
        
        const mentionRegex = /@(\w+)/g;
        const formattedMessage = message.replace(mentionRegex, (match, mentionedUser) => {
            if (mentionedUser === state.username) {
                return `<span class="mention">${match}</span>`;
            }
            return match;
        });

        messageDiv.innerHTML = `
            <div class="message-info">${username}</div>
            ${replyHTML}
            <div class="message-content">${marked.parse(formattedMessage)}</div>
            <div class="message-meta">
                ${edited ? '<i>(edited)</i> ' : ''}${timestamp}
            </div>
        `;

        wrapper.appendChild(avatar);
        wrapper.appendChild(messageDiv);
        
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        actions.innerHTML = `
            <button class="reply-btn" data-id="${id}" data-username="${username}"><i class="ri-reply-line"></i></button>
            ${isOwnMessage ? `<button class="edit-btn" data-id="${id}"><i class="ri-pencil-line"></i></button><button class="delete-btn" data-id="${id}"><i class="ri-delete-bin-line"></i></button>` : ''}
        `;
        
        if(isOwnMessage) {
            wrapper.appendChild(actions);
        } else {
            wrapper.insertBefore(actions, wrapper.firstChild);
        }

        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function updateUserList(users) {
        userList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            const avatar = `<div class="user-avatar" style="background-color: ${generateColor(user)}">${user.charAt(0).toUpperCase()}</div>`;
            let actions = '';
            if (state.isOwner && user !== state.username) {
                actions = `
                    <div class="user-actions">
                        <button class="kick-btn" data-username="${user}" title="Kick User"><i class="ri-logout-box-r-line"></i></button>
                        <button class="ban-btn" data-username="${user}" title="Ban User"><i class="ri-prohibited-line"></i></button>
                    </div>
                `;
            }
            li.innerHTML = `${avatar}<span>${user}</span>${actions}`;
            userList.appendChild(li);
        });
    }

    function cancelReply() {
        state.replyingTo = null;
        replyPreview.style.display = 'none';
    }

    function generateColor(str) {
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
    }

    // --- Event Delegation ---
    messagesContainer.addEventListener('click', e => {
        const replyBtn = e.target.closest('.reply-btn');
        const editBtn = e.target.closest('.edit-btn');
        const deleteBtn = e.target.closest('.delete-btn');

        if (replyBtn) {
            state.replyingTo = { id: replyBtn.dataset.id, username: replyBtn.dataset.username };
            document.getElementById('reply-username').textContent = state.replyingTo.username;
            replyPreview.style.display = 'flex';
            messageInput.focus();
        }
        if (editBtn) {
            state.editingId = editBtn.dataset.id;
            const currentText = document.querySelector(`#msg-${state.editingId} .message-content`).innerText;
            document.getElementById('edit-textarea').value = currentText;
            editModal.classList.add('active');
        }
        if (deleteBtn) {
            if (confirm('Are you sure you want to delete this message?')) {
                socket.emit('delete-message', { roomCode: state.currentRoom, messageId: deleteBtn.dataset.id });
            }
        }
    });

    userList.addEventListener('click', e => {
        const kickBtn = e.target.closest('.kick-btn');
        const banBtn = e.target.closest('.ban-btn');
        if (kickBtn) {
            const username = kickBtn.dataset.username;
            if (confirm(`Are you sure you want to kick ${username}?`)) {
                socket.emit('kick-user', { roomCode: state.currentRoom, username });
            }
        }
        if (banBtn) {
            const username = banBtn.dataset.username;
            if (confirm(`Are you sure you want to BAN ${username}? This is permanent.`)) {
                socket.emit('ban-user', { roomCode: state.currentRoom, username });
            }
        }
    });

    document.getElementById('cancel-reply-btn').addEventListener('click', cancelReply);
    document.getElementById('save-edit-btn').addEventListener('click', () => {
        const newMessage = document.getElementById('edit-textarea').value.trim();
        if (newMessage && state.editingId) {
            socket.emit('edit-message', { roomCode: state.currentRoom, messageId: state.editingId, newMessage });
            editModal.classList.remove('active');
        }
    });
    document.getElementById('cancel-edit-btn').addEventListener('click', () => editModal.classList.remove('active'));
    document.getElementById('clear-chat-btn').addEventListener('click', () => {
        if (confirm('Are you sure you want to delete ALL messages in this room? This cannot be undone.')) {
            socket.emit('clear-chat', { roomCode: state.currentRoom });
        }
    });

    // --- Socket Handlers ---
    socket.on('message-edited', ({ messageId, newMessage }) => {
        const messageContent = document.querySelector(`#msg-${messageId} .message-content`);
        const messageMeta = document.querySelector(`#msg-${messageId} .message-meta`);
        if (messageContent) messageContent.innerHTML = marked.parse(newMessage);
        if (messageMeta && !messageMeta.innerText.includes('edited')) {
            messageMeta.innerHTML = `<i>(edited)</i> ${messageMeta.innerText}`;
        }
    });
    socket.on('message-deleted', messageId => document.getElementById(`msg-wrapper-${messageId}`)?.remove());
    socket.on('chat-cleared', () => messagesContainer.innerHTML = '');
    socket.on('kicked', () => {
        alert('You have been kicked from the room.');
        window.location.reload();
    });
    socket.on('user-banned', username => displayNotification(`${username} has been banned from the room.`));

    // Other handlers (join, etc.) are in the previous versions
    // For brevity, they are omitted but assumed to be here.
});
