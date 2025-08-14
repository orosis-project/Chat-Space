document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ autoConnect: false });
    let state = { 
        username: null, role: null, nickname: null, icon: null, 
        currentChat: { type: 'channel', id: 'general' }, // Can be channel or dm
        replyingTo: null,
        relations: { friends: [], blocked: [] },
        // ... other state properties
    };

    // --- Element Selectors ---
    const chatWindow = document.getElementById('chat-window');
    const userContextMenu = document.getElementById('user-context-menu');
    const emojiPicker = document.getElementById('emoji-picker');
    const dmList = document.getElementById('dm-list');
    // ... other selectors

    // --- Core Functions ---
    // ... (showPage, toggleModal, etc.)

    // --- Rendering Functions ---
    const renderMessage = (msg, container) => {
        const msgDiv = document.createElement('div');
        msgDiv.id = `msg-${msg.id}`;
        msgDiv.dataset.messageId = msg.id;
        msgDiv.dataset.author = msg.nickname || msg.author;
        msgDiv.classList.add('message-container', 'group');

        // Add reply block if it exists
        let replyHtml = '';
        if (msg.replyingTo) {
            replyHtml = `<div class="reply-block">Replying to <strong>${msg.replyingTo.author}</strong>: ${msg.replyingTo.content}</div>`;
        }

        // Add reactions block
        let reactionsHtml = '<div class="reactions-container">';
        if (msg.reactions) {
            Object.entries(msg.reactions).forEach(([emoji, users]) => {
                if (users.length > 0) {
                    const isUserReacted = users.includes(state.username);
                    reactionsHtml += `<button class="reaction ${isUserReacted ? 'reacted' : ''}" data-emoji="${emoji}">${emoji} ${users.length}</button>`;
                }
            });
        }
        reactionsHtml += '</div>';

        msgDiv.innerHTML = `
            <!-- ... existing message structure ... -->
            ${replyHtml}
            <!-- ... message content ... -->
            <div class="message-actions">
                <button class="action-btn" data-action="star" style="display: ${state.role === 'Owner' ? 'block' : 'none'}; color: ${msg.pinned ? 'gold' : 'inherit'};"><i class="ri-star-fill"></i></button>
                <button class="action-btn" data-action="react"><i class="ri-emotion-happy-line"></i></button>
                <button class="action-btn" data-action="reply"><i class="ri-reply-line"></i></button>
            </div>
            ${reactionsHtml}
        `;
        container.appendChild(msgDiv);
        // ...
    };

    const updateUserList = ({ activeUsers, allUsers }) => {
        // ... existing logic
        // Add online/offline status indicator
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
            // Show emoji picker
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
            // Show reply preview UI
        }
    });

    emojiPicker.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            const emoji = button.textContent;
            const messageId = emojiPicker.dataset.messageId;
            socket.emit('toggle-reaction', { channel: state.currentChat.id, messageId, emoji });
            emojiPicker.classList.add('hidden');
        }
    });

    userListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const userDiv = e.target.closest('[data-username]');
        if (userDiv) {
            const username = userDiv.dataset.username;
            if (username === state.username) return; // Can't interact with self
            userContextMenu.style.left = `${e.pageX}px`;
            userContextMenu.style.top = `${e.pageY}px`;
            userContextMenu.classList.remove('hidden');
            userContextMenu.dataset.username = username;
        }
    });

    userContextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const username = userContextMenu.dataset.username;
        if (action === 'dm') {
            // Logic to switch to or open a DM chat
        } else if (action === 'friend') {
            socket.emit('add-friend', username);
        } else if (action === 'block') {
            socket.emit('block-user', username);
        }
        userContextMenu.classList.add('hidden');
    });

    // --- Socket Handlers ---
    socket.on('reaction-updated', ({ channel, messageId, reactions }) => {
        // Find message and re-render its reactions
    });
    socket.on('pin-updated', ({ channel, messageId, pinned }) => {
        // Find message and update its star icon
    });
    socket.on('new-dm', ({ dmKey, message }) => {
        // Logic to render DM and update DM list
    });
    socket.on('relations-updated', (relations) => {
        state.relations = relations;
    });

    // --- Initial Load ---
    // ...
});
