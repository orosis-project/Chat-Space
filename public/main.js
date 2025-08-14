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
        } else {
            const dmKey = [state.username, id].sort().join('-');
            messages = state.dms[dmKey]?.messages || [];
        }
        messages.forEach(msg => renderMessage(msg, chatWindow));
    };

    // --- Rendering Functions ---
    const renderMessage = (msg, container) => { /* ... (same as previous correct version) ... */ };
    const updateUserList = ({ activeUsers, allUsersData }) => { /* ... (same as previous correct version) ... */ };
    const updateDmList = () => { /* ... (same as previous correct version) ... */ };

    // --- Event Handlers ---
    joinCodeForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // This is the critical fix for the reload bug
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
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // ... login logic
    });

    messageForm.addEventListener('submit', (e) => { /* ... */ });
    chatWindow.addEventListener('click', (e) => { /* ... */ });
    
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

    // ... other event handlers
});
