document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ autoConnect: false });
    let state = { 
        username: null, role: null, nickname: null, icon: null, 
        currentChat: { type: 'channel', id: 'general' },
        replyingTo: null,
        relations: { friends: [], blocked: [] },
        allUsers: {},
        activeUsers: {},
        channels: {},
        dms: {}
    };

    // --- Element Selectors ---
    const chatWindow = document.getElementById('chat-window');
    const userContextMenu = document.getElementById('user-context-menu');
    const emojiPicker = document.getElementById('emoji-picker');
    const dmList = document.getElementById('dm-list');
    const channelsList = document.getElementById('channels-list');
    const userListContainer = document.getElementById('user-list-container');
    const replyPreview = document.getElementById('reply-preview');
    const replyAuthor = document.getElementById('reply-author');
    const replyPreviewText = document.getElementById('reply-preview-text');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const channelTitle = document.getElementById('channel-title');
    // ... other selectors from index.html

    // --- Initial Setup ---
    const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
    EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        emojiPicker.appendChild(btn);
    });

    // --- Core Functions ---
    const switchChat = (type, id) => {
        state.currentChat = { type, id };
        document.querySelectorAll('.chat-link').forEach(l => l.classList.remove('active'));
        const link = document.querySelector(`.chat-link[data-id="${id}"]`);
        if (link) link.classList.add('active');
        
        channelTitle.textContent = (type === 'channel' ? '# ' : '') + id;
        chatWindow.innerHTML = '';
        
        let messages = [];
        if (type === 'channel') {
            messages = state.channels[id]?.messages || [];
        } else { // dm
            const dmKey = [state.username, id].sort().join('-');
            messages = state.dms[dmKey]?.messages || [];
        }
        messages.forEach(msg => renderMessage(msg, chatWindow));
    };

    // --- Rendering Functions ---
    const renderMessage = (msg, container) => {
        const msgDiv = document.createElement('div');
        msgDiv.id = `msg-${msg.id}`;
        msgDiv.dataset.messageId = msg.id;
        const authorNickname = msg.senderNickname || msg.nickname || msg.sender || msg.author;
        msgDiv.dataset.author = authorNickname;
        msgDiv.dataset.authorUsername = msg.sender || msg.author;
        msgDiv.classList.add('message-container', 'group', 'relative', 'flex', 'items-start', 'gap-3', 'p-2', 'rounded-lg');
        msgDiv.addEventListener('mouseenter', () => msgDiv.querySelector('.message-actions').classList.remove('hidden'));
        msgDiv.addEventListener('mouseleave', () => msgDiv.querySelector('.message-actions').classList.add('hidden'));

        let replyHtml = '';
        if (msg.replyingTo) {
            replyHtml = `<div class="reply-block">Replying to <strong>${msg.replyingTo.author}</strong>: <span class="truncate italic text-gray-600 dark:text-gray-400">${msg.replyingTo.content}</span></div>`;
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
        const authorIcon = state.allUsers[msg.sender || msg.author]?.icon || 'https://placehold.co/40x40/64748b/ffffff?text=?';

        msgDiv.innerHTML = `
            <img src="${authorIcon}" class="w-10 h-10 rounded-full object-cover flex-shrink-0 mt-1">
            <div class="w-full">
                ${replyHtml}
                <p class="font-bold dark:text-white">${authorNickname} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">${new Date(msg.timestamp).toLocaleTimeString()}</span></p>
                <div class="prose prose-sm dark:prose-invert max-w-none">${parsedContent}</div>
                ${reactionsHtml}
            </div>
            <div class="message-actions hidden">
                <button class="action-btn" data-action="star" style="display: ${state.role === 'Owner' && state.currentChat.type === 'channel' ? 'flex' : 'none'}; color: ${msg.pinned ? '#facc15' : 'inherit'};"><i class="ri-star-fill"></i></button>
                <button class="action-btn" data-action="react"><i class="ri-emotion-happy-line"></i></button>
                <button class="action-btn" data-action="reply"><i class="ri-reply-line"></i></button>
            </div>
        `;
        container.appendChild(msgDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    const updateUserList = ({ activeUsers, allUsersData }) => {
        state.activeUsers = activeUsers;
        state.allUsers = allUsersData;
        userListContainer.innerHTML = '';
        Object.keys(allUsersData).forEach(username => {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-list-item';
            userDiv.dataset.username = username;
            const isActive = !!activeUsers[username];
            userDiv.innerHTML = `
                <div class="relative">
                    <img src="${allUsersData[username].icon || 'https://placehold.co/40x40/64748b/ffffff?text=?'}" class="w-8 h-8 rounded-full object-cover">
                    <span class="status-indicator ${isActive ? 'online' : 'offline'}"></span>
                </div>
                <span class="font-semibold dark:text-white truncate">${allUsersData[username].nickname || username}</span>
            `;
            userListContainer.appendChild(userDiv);
        });
    };

    const updateDmList = () => {
        dmList.innerHTML = '';
        const myDms = Object.keys(state.dms).filter(key => key.includes(state.username));
        myDms.forEach(dmKey => {
            const partner = dmKey.replace(state.username, '').replace('-', '');
            const link = document.createElement('a');
            link.href = '#';
            link.className = 'chat-link user-list-item';
            link.dataset.type = 'dm';
            link.dataset.id = partner;
            const partnerData = state.allUsers[partner];
            link.innerHTML = `
                <div class="relative">
                     <img src="${partnerData?.icon || 'https://placehold.co/40x40/64748b/ffffff?text=?'}" class="w-8 h-8 rounded-full object-cover">
                     <span class="status-indicator ${state.activeUsers[partner] ? 'online' : 'offline'}"></span>
                </div>
                <span class="font-semibold dark:text-white truncate">${partnerData?.nickname || partner}</span>
            `;
            dmList.appendChild(link);
        });
    };

    // --- Event Handlers ---
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        if (state.currentChat.type === 'channel') {
            socket.emit('send-message', { channel: state.currentChat.id, message, replyingTo: state.replyingTo });
        } else {
            socket.emit('send-dm', { recipient: state.currentChat.id, message });
        }
        
        messageInput.value = '';
        state.replyingTo = null;
        replyPreview.classList.add('hidden');
    });

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

    userListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const userDiv = e.target.closest('[data-username]');
        if (userDiv) {
            const username = userDiv.dataset.username;
            if (username === state.username) return;
            userContextMenu.style.left = `${e.pageX}px`;
            userContextMenu.style.top = `${e.pageY}px`;
            userContextMenu.classList.remove('hidden');
            userContextMenu.dataset.username = username;
        }
    });

    userContextMenu.addEventListener('click', (e) => {
        const action = e.target.closest('button')?.dataset.action;
        const username = userContextMenu.dataset.username;
        if (action === 'dm') switchChat('dm', username);
        else if (action) socket.emit('update-relation', { targetUser: username, type: action });
        userContextMenu.classList.add('hidden');
    });

    document.addEventListener('click', () => {
        userContextMenu.classList.add('hidden');
        emojiPicker.classList.add('hidden');
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        // Show chat page and store initial data
        document.getElementById('chat-page').classList.replace('hidden', 'flex');
        document.getElementById('join-code-page').classList.replace('active', 'hidden');
        state = { ...state, ...data.currentUser, channels: data.channels, dms: data.dms, allUsers: data.allUsers, relations: data.userRelations };
        updateDmList();
        switchChat('channel', 'general');
    });
    
    socket.on('update-user-list', updateUserList);
    socket.on('new-message', ({ channel, message }) => {
        state.channels[channel].messages.push(message);
        if (state.currentChat.type === 'channel' && state.currentChat.id === channel) {
            renderMessage(message, chatWindow);
        }
    });
    socket.on('new-dm', ({ dmKey, message, partner }) => {
        state.dms[dmKey] = state.dms[dmKey] || { messages: [] };
        state.dms[dmKey].messages.push(message);
        updateDmList();
        if (state.currentChat.type === 'dm' && state.currentChat.id === partner) {
            renderMessage(message, chatWindow);
        }
    });

    socket.on('reaction-updated', ({ chatType, chatId, messageId, reactions }) => {
        if (chatId !== state.currentChat.id) return;
        const msgDiv = document.getElementById(`msg-${messageId}`);
        // Re-render reactions on the specific message
    });

    socket.on('pin-updated', ({ channel, messageId, pinned }) => {
        if (channel !== state.currentChat.id) return;
        const starBtn = document.querySelector(`#msg-${messageId} [data-action="star"]`);
        if (starBtn) starBtn.style.color = pinned ? '#facc15' : 'inherit';
    });

    socket.on('relations-updated', (relations) => {
        state.relations = relations;
    });

    // Bind other event listeners from previous versions
});
