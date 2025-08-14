document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ autoConnect: false });
    let state = { 
        username: null, role: null, nickname: null, icon: null, 
        currentChat: { type: 'channel', id: 'general' },
        replyingTo: null,
        relations: { friends: [], blocked: [] },
        allUsers: {},
        activeUsers: {}
    };

    // --- Element Selectors ---
    const chatWindow = document.getElementById('chat-window');
    const userContextMenu = document.getElementById('user-context-menu');
    const emojiPicker = document.getElementById('emoji-picker');
    const dmList = document.getElementById('dm-list');
    const userListContainer = document.getElementById('user-list-container');
    const replyPreview = document.getElementById('reply-preview');
    const replyAuthor = document.getElementById('reply-author');
    const replyPreviewText = document.getElementById('reply-preview-text');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const channelTitle = document.getElementById('channel-title');
    // ... other selectors

    // --- Core Functions ---
    const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
    EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        emojiPicker.appendChild(btn);
    });

    const switchChat = (type, id) => {
        state.currentChat = { type, id };
        document.querySelectorAll('.chat-link').forEach(l => l.classList.remove('active'));
        document.querySelector(`.chat-link[data-id="${id}"]`)?.classList.add('active');
        channelTitle.textContent = (type === 'channel' ? '# ' : '') + id;
        chatWindow.innerHTML = '';
        // Request history for the new chat
    };

    // --- Rendering Functions ---
    const renderMessage = (msg, container) => {
        const msgDiv = document.createElement('div');
        msgDiv.id = `msg-${msg.id}`;
        msgDiv.dataset.messageId = msg.id;
        msgDiv.dataset.author = msg.nickname || msg.author;
        msgDiv.dataset.authorUsername = msg.author;
        msgDiv.classList.add('message-container', 'group');

        let replyHtml = '';
        if (msg.replyingTo) {
            replyHtml = `<div class="reply-block">Replying to <strong>${msg.replyingTo.author}</strong>: <span class="truncate">${msg.replyingTo.content}</span></div>`;
        }
        
        const reactions = msg.reactions || {};
        let reactionsHtml = '<div class="reactions-container">';
        Object.entries(reactions).forEach(([emoji, users]) => {
            if (users.length > 0) {
                const isUserReacted = users.includes(state.username);
                reactionsHtml += `<button class="reaction ${isUserReacted ? 'reacted' : ''}" data-emoji="${emoji}">${emoji} ${users.length}</button>`;
            }
        });
        reactionsHtml += '</div>';

        const parsedContent = marked.parse(msg.content.replace(/@([a-zA-Z0-9_ ;)]+)/g, '<span class="mention">@$1</span>'));

        msgDiv.innerHTML = `
            <div class="flex items-start gap-3">
                <img src="${msg.icon}" class="w-10 h-10 rounded-full object-cover flex-shrink-0">
                <div class="w-full">
                    ${replyHtml}
                    <p class="font-bold dark:text-white">${msg.nickname || msg.author} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">${new Date(msg.timestamp).toLocaleTimeString()}</span></p>
                    <div class="prose prose-sm dark:prose-invert max-w-none">${parsedContent}</div>
                    ${reactionsHtml}
                </div>
            </div>
            <div class="message-actions">
                <button class="action-btn" data-action="star" style="display: ${state.role === 'Owner' ? 'flex' : 'none'}; color: ${msg.pinned ? '#facc15' : 'inherit'};"><i class="ri-star-fill"></i></button>
                <button class="action-btn" data-action="react"><i class="ri-emotion-happy-line"></i></button>
                <button class="action-btn" data-action="reply"><i class="ri-reply-line"></i></button>
            </div>
        `;
        container.appendChild(msgDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    const updateUserList = ({ activeUsers, allUsers }) => {
        state.activeUsers = activeUsers;
        state.allUsers = allUsers;
        userListContainer.innerHTML = '';
        allUsers.forEach(username => {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-list-item';
            userDiv.dataset.username = username;
            const isActive = !!activeUsers[username];
            userDiv.innerHTML = `
                <div class="relative">
                    <img src="${activeUsers[username]?.icon || 'https://placehold.co/40x40/64748b/ffffff?text=?'}" class="w-8 h-8 rounded-full object-cover">
                    <span class="status-indicator ${isActive ? 'online' : 'offline'}"></span>
                </div>
                <span class="font-semibold dark:text-white truncate">${activeUsers[username]?.nickname || username}</span>
            `;
            userListContainer.appendChild(userDiv);
        });
    };

    // --- Event Handlers ---
    chatWindow.addEventListener('click', (e) => {
        const target = e.target;
        const messageContainer = target.closest('.message-container');
        if (!messageContainer) return;

        const messageId = messageContainer.dataset.messageId;
        const action = target.closest('.action-btn')?.dataset.action;

        if (action === 'star') {
            socket.emit('toggle-pin', { channel: state.currentChat.id, messageId });
        } else if (action === 'react') {
            emojiPicker.style.left = `${e.pageX}px`;
            emojiPicker.style.top = `${e.pageY}px`;
            emojiPicker.classList.remove('hidden');
            emojiPicker.dataset.messageId = messageId;
        } else if (action === 'reply') {
            state.replyingTo = {
                id: messageId,
                author: messageContainer.dataset.author,
                content: messageContainer.querySelector('.prose').textContent.substring(0, 50) + '...'
            };
            replyAuthor.textContent = state.replyingTo.author;
            replyPreviewText.textContent = state.replyingTo.content;
            replyPreview.classList.remove('hidden');
            messageInput.focus();
        }
    });
    
    cancelReplyBtn.addEventListener('click', () => {
        state.replyingTo = null;
        replyPreview.classList.add('hidden');
    });

    emojiPicker.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            const emoji = button.textContent;
            const messageId = emojiPicker.dataset.messageId;
            socket.emit('toggle-reaction', { chatType: state.currentChat.type, chatId: state.currentChat.id, messageId, emoji });
            emojiPicker.classList.add('hidden');
        }
    });

    userListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const userDiv = e.target.closest('[data-username]');
        if (userDiv) {
            const username = userDiv.dataset.username;
            if (username === state.username) return;
            // Configure and show context menu
            userContextMenu.style.left = `${e.pageX}px`;
            userContextMenu.style.top = `${e.pageY}px`;
            userContextMenu.classList.remove('hidden');
            userContextMenu.dataset.username = username;
        }
    });
    
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        if (state.currentChat.type === 'channel') {
            socket.emit('send-message', { channel: state.currentChat.id, message, replyingTo: state.replyingTo });
        } else { // DM
            socket.emit('send-dm', { recipient: state.currentChat.id, message });
        }
        
        messageInput.value = '';
        state.replyingTo = null;
        replyPreview.classList.add('hidden');
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => { /* ... */ });
    socket.on('update-user-list', updateUserList);
    socket.on('new-message', ({ channel, message }) => {
        if (state.currentChat.type === 'channel' && state.currentChat.id === channel) {
            renderMessage(message, chatWindow);
        }
    });
    socket.on('reaction-updated', ({ chatId, messageId, reactions }) => {
        if (chatId !== state.currentChat.id) return;
        // Find message and re-render reactions
    });
    socket.on('pin-updated', ({ channel, messageId, pinned }) => {
        // Find message and update star icon
    });
    socket.on('new-dm', ({ dmKey, message, partner }) => {
        // Update DM list and render message if chat is active
    });
    socket.on('relations-updated', (relations) => {
        state.relations = relations;
    });

    // --- Initial Load ---
    // ...
});
