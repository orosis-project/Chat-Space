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
    const pages = { joinCode: document.getElementById('join-code-page'), login: document.getElementById('login-page'), chat: document.getElementById('chat-page') };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
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
    const addChannelBtn = document.getElementById('add-channel-btn');

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
        
        channelTitle.textContent = (type === 'channel' ? '# ' : '') + (state.allUsers[id]?.nickname || id);
        chatWindow.innerHTML = '';
        
        let messages = [];
        if (type === 'channel') {
            messages = state.channels[id]?.messages || [];
        } else {
            const dmKey = [state.username, id].sort().join('-');
            messages = state.dms[dmKey]?.messages || [];
        }
        messages.forEach(msg => renderMessage(msg, chatWindow));
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    // --- Rendering Functions ---
    const renderMessage = (msg, container) => {
        const authorUsername = msg.sender || msg.author;
        if (state.relations.blocked.includes(authorUsername)) return;

        const msgDiv = document.createElement('div');
        msgDiv.id = `msg-${msg.id}`;
        msgDiv.dataset.messageId = msg.id;
        const authorNickname = msg.senderNickname || msg.nickname || msg.sender || msg.author;
        msgDiv.dataset.author = authorNickname;
        msgDiv.dataset.authorUsername = authorUsername;
        msgDiv.classList.add('message-container', 'group', 'relative', 'flex', 'items-start', 'gap-3', 'p-2', 'rounded-lg');
        
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
        const authorIcon = state.allUsers[authorUsername]?.icon || 'https://placehold.co/40x40/64748b/ffffff?text=?';

        msgDiv.innerHTML = `
            <img src="${authorIcon}" class="w-10 h-10 rounded-full object-cover flex-shrink-0 mt-1">
            <div class="w-full">
                ${replyHtml}
                <p class="font-bold dark:text-white">${authorNickname} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">${new Date(msg.timestamp).toLocaleTimeString()}</span></p>
                <div class="prose prose-sm dark:prose-invert max-w-none">${parsedContent}</div>
                ${reactionsHtml}
            </div>
            <div class="message-actions">
                <button class="action-btn" data-action="star" style="display: ${state.role === 'Owner' && state.currentChat.type === 'channel' ? 'flex' : 'none'}; color: ${msg.pinned ? '#facc15' : 'inherit'};"><i class="ri-star-fill"></i></button>
                <button class="action-btn" data-action="react"><i class="ri-emotion-happy-line"></i></button>
                <button class="action-btn" data-action="reply"><i class="ri-reply-line"></i></button>
            </div>
        `;
        container.appendChild(msgDiv);
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
    const handleJoinAttempt = async () => {
        const joinError = document.getElementById('join-error');
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            const response = await fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            pages.joinCode.classList.replace('active', 'hidden');
            pages.login.classList.replace('hidden', 'active');
        } catch (error) {
            joinError.textContent = error.message;
        }
    };

    joinCodeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleJoinAttempt();
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loginError = document.getElementById('login-error');
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        try {
            const response = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            socket.auth = { username };
            socket.connect();
            socket.emit('user-connect', { username: data.username, role: data.role, nickname: data.nickname });
        } catch (error) {
            loginError.textContent = error.message;
        }
    });

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
            
            const moderationActions = userContextMenu.querySelector('.moderation-actions');
            const canModerate = ['Moderator', 'Co-Owner', 'Owner'].includes(state.role);
            moderationActions.style.display = canModerate ? 'block' : 'none';

            userContextMenu.style.left = `${e.pageX}px`;
            userContextMenu.style.top = `${e.pageY}px`;
            userContextMenu.classList.remove('hidden');
            userContextMenu.dataset.username = username;
        }
    });

    userContextMenu.addEventListener('click', (e) => {
        const action = e.target.closest('button')?.dataset.action;
        const username = userContextMenu.dataset.username;
        if (!action || !username) return;

        if (action === 'dm') switchChat('dm', username);
        else if (['friend', 'unfriend', 'block', 'unblock'].includes(action)) {
            socket.emit('update-relation', { targetUser: username, type: action });
        } else if (action === 'kick') {
            socket.emit('kick-user', { targetUsername: username });
        } else if (action === 'ban') {
            socket.emit('ban-user', { targetUsername: username });
        }
        userContextMenu.classList.add('hidden');
    });

    cancelReplyBtn.addEventListener('click', () => {
        state.replyingTo = null;
        replyPreview.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!userContextMenu.contains(e.target) && !e.target.closest('[data-username]')) {
            userContextMenu.classList.add('hidden');
        }
        if (!emojiPicker.contains(e.target) && !e.target.closest('[data-action="react"]')) {
            emojiPicker.classList.add('hidden');
        }
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        pages.login.classList.replace('active', 'hidden');
        pages.chat.classList.replace('hidden', 'flex');
        state = { ...state, ...data.currentUser, channels: data.channels, dms: data.dms, allUsers: data.allUsers, relations: data.userRelations };
        updateDmList();
        switchChat('channel', 'general');
    });
    
    socket.on('update-user-list', updateUserList);
    
    socket.on('new-message', ({ channel, message }) => {
        state.channels[channel].messages.push(message);
        if (state.currentChat.type === 'channel' && state.currentChat.id === channel) {
            renderMessage(message, chatWindow);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    });
    
    socket.on('new-dm', ({ dmKey, message, partner }) => {
        state.dms[dmKey] = state.dms[dmKey] || { messages: [] };
        state.dms[dmKey].messages.push(message);
        updateDmList();
        if (state.currentChat.type === 'dm' && state.currentChat.id === partner) {
            renderMessage(message, chatWindow);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    });

    socket.on('reaction-updated', ({ chatType, chatId, messageId, reactions }) => {
        if (chatId !== state.currentChat.id) return;
        const msgDiv = document.getElementById(`msg-${messageId}`);
        if (!msgDiv) return;
        
        let message;
        if (chatType === 'channel') {
            message = state.channels[chatId]?.messages.find(m => m.id === messageId);
        } else {
            message = state.dms[chatId]?.messages.find(m => m.id === messageId);
        }
        if (message) message.reactions = reactions;

        let reactionsHtml = '';
        Object.entries(reactions).forEach(([emoji, users]) => {
            if (users.length > 0) {
                const isUserReacted = users.includes(state.username);
                reactionsHtml += `<button class="reaction ${isUserReacted ? 'reacted' : ''}" data-emoji="${emoji}">${emoji} ${users.length}</button>`;
            }
        });
        msgDiv.querySelector('.reactions-container').innerHTML = reactionsHtml;
    });

    socket.on('pin-updated', ({ channel, messageId, pinned }) => {
        if (channel !== state.currentChat.id) return;
        const msg = state.channels[channel]?.messages.find(m => m.id === messageId);
        if (msg) msg.pinned = pinned;

        const starBtn = document.querySelector(`#msg-${messageId} [data-action="star"]`);
        if (starBtn) starBtn.style.color = pinned ? '#facc15' : 'inherit';
    });

    socket.on('relations-updated', (relations) => {
        state.relations = relations;
    });
});
