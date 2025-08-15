document.addEventListener('DOMContentLoaded', async () => {
    let GIPHY_API_KEY = null;
    try {
        const response = await fetch('/api/giphy-key');
        const data = await response.json();
        GIPHY_API_KEY = data.apiKey;
    } catch (e) { console.error("Could not fetch Giphy API key."); }

    const socket = io({ autoConnect: false });
    let state = { 
        username: null, role: null, nickname: null, icon: null, 
        currentChat: { type: 'channel', id: 'general' },
        replyingTo: null,
        relations: { friends: [], blocked: [] },
        allUsers: {}, activeUsers: {}, channels: {}, dms: {},
        permissions: {}, currentUserData: {}
    };

    // --- Element Selectors ---
    const pages = { joinCode: document.getElementById('join-code-page'), login: document.getElementById('login-page'), chat: document.getElementById('chat-page') };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const termsModal = document.getElementById('terms-modal');
    const agreeTermsBtn = document.getElementById('agree-terms-btn');
    const tutorialModal = document.getElementById('tutorial-modal');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
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
    const channelTitle = document.getElementById('channel-title');
    const addChannelBtn = document.getElementById('add-channel-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const userDatabaseBtn = document.getElementById('user-database-btn');
    const statusSelector = document.getElementById('status-selector');
    const invisibleOption = document.getElementById('invisible-option');
    const userDbModal = document.getElementById('user-database-modal');
    const userDbList = document.getElementById('user-db-list');
    const closeUserDbBtn = document.getElementById('close-user-db-btn');
    const userEditModal = document.getElementById('user-edit-modal');
    const reactionPopup = document.getElementById('reaction-popup');
    const giphyModal = document.getElementById('giphy-modal');
    const giphyBtn = document.getElementById('giphy-btn');
    const closeGiphyBtn = document.getElementById('close-giphy-btn');
    const giphySearchInput = document.getElementById('giphy-search-input');
    const giphyResultsGrid = document.getElementById('giphy-results-grid');
    const chatStatusBanner = document.getElementById('chat-status-banner');
    const gameContainer = document.getElementById('game-container');
    const typingIndicator = document.getElementById('typing-indicator');
    const userProfileModal = document.getElementById('user-profile-modal');
    const muteModal = document.getElementById('mute-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const ownerSettingsTabs = document.getElementById('owner-settings-tabs');
    const profileTabContent = document.getElementById('profile-tab-content');
    const preferencesTabContent = document.getElementById('preferences-tab-content');
    const userManagementTabContent = document.getElementById('user-management-tab-content');
    const permissionsTabContent = document.getElementById('permissions-tab-content');
    const auditLogTabContent = document.getElementById('audit-log-tab-content');
    const permissionsList = document.getElementById('permissions-list');
    const auditLogList = document.getElementById('audit-log-list');
    const userManagementList = document.getElementById('user-management-list');
    
    // --- Rendering Functions ---

    const renderMessage = (message) => {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('flex', 'items-start', 'gap-3', 'p-2', 'rounded-lg', 'hover:bg-gray-100', 'dark:hover:bg-gray-800');
        msgDiv.dataset.messageId = message.id;

        const authorData = state.allUsers[message.author] || {};
        // **FIX:** Use a working placeholder URL
        const icon = authorData.icon === 'default' || !authorData.icon 
            ? `https://placehold.co/40x40/7c3aed/ffffff?text=${message.nickname.charAt(0).toUpperCase()}` 
            : authorData.icon;

        let contentHTML = marked.parse(message.content);

        msgDiv.innerHTML = `
            <img src="${icon}" alt="${message.nickname}" class="w-10 h-10 rounded-full">
            <div class="flex-grow">
                <div class="flex items-baseline gap-2">
                    <strong class="dark:text-white">${message.nickname}</strong>
                    <time class="text-xs text-gray-500 dark:text-gray-400">${new Date(message.timestamp).toLocaleTimeString()}</time>
                </div>
                <div class="prose dark:prose-invert max-w-none text-gray-800 dark:text-gray-200">${contentHTML}</div>
            </div>
        `;
        return msgDiv;
    };

    const renderAllMessages = (messages) => {
        chatWindow.innerHTML = '';
        if (messages && messages.length > 0) {
            messages.forEach(msg => {
                chatWindow.appendChild(renderMessage(msg));
            });
        } else {
            chatWindow.innerHTML = `<div class="text-center text-gray-500 p-4">No messages yet. Say hello!</div>`;
        }
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    const renderChannels = () => {
        channelsList.innerHTML = '';
        Object.keys(state.channels).forEach(channelId => {
            const channel = state.channels[channelId];
            const channelDiv = document.createElement('div');
            channelDiv.classList.add('px-3', 'py-2', 'rounded-md', 'cursor-pointer', 'hover:bg-gray-300', 'dark:hover:bg-gray-700', 'transition-colors', 'duration-150');
            if (channelId === state.currentChat.id) {
                channelDiv.classList.add('bg-blue-500', 'text-white', 'font-semibold');
            } else {
                 channelDiv.classList.add('dark:text-gray-300');
            }
            channelDiv.textContent = `# ${channelId}`;
            channelDiv.dataset.channelId = channelId;
            channelsList.appendChild(channelDiv);
        });
    };

    const renderUsers = () => {
        userListContainer.innerHTML = '';
        const onlineUsers = Object.keys(state.activeUsers);
        
        const categoryDiv = document.createElement('div');
        categoryDiv.innerHTML = `<h3 class="font-bold text-sm text-gray-500 dark:text-gray-400 uppercase mb-2">Online — ${onlineUsers.length}</h3>`;
        
        onlineUsers.forEach(username => {
            const user = state.activeUsers[username];
            const userData = state.allUsers[username] || {};
            // **FIX:** Use a working placeholder URL
            const icon = userData.icon === 'default' || !userData.icon 
                ? `https://placehold.co/32x32/7c3aed/ffffff?text=${user.nickname.charAt(0).toUpperCase()}`
                : userData.icon;
            
            const userDiv = document.createElement('div');
            userDiv.classList.add('flex', 'items-center', 'gap-2', 'p-1.5', 'rounded-md', 'hover:bg-gray-300', 'dark:hover:bg-gray-700', 'cursor-pointer');
            userDiv.dataset.username = username;
            
            userDiv.innerHTML = `
                <div class="relative">
                    <img src="${icon}" alt="${user.nickname}" class="w-8 h-8 rounded-full">
                    <span class="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-400 border-2 border-white dark:border-gray-800"></span>
                </div>
                <span class="font-medium text-sm dark:text-gray-200 truncate">${user.nickname}</span>
            `;
            categoryDiv.appendChild(userDiv);
        });
        userListContainer.appendChild(categoryDiv);
    };

    // --- Tutorial Content ---
    const TUTORIALS = {
        Member: [
            { title: "Communicating", content: "You can send messages, GIFs, reply to messages, and react to them by long-pressing." },
            { title: "Branches & DMs", content: "Join different public chat branches or start a private Direct Message by right-clicking a user." },
            { title: "User Database", content: "Click the 'Users' button to see everyone in the chat, even if they're offline. You can friend, block, or DM them from there." }
        ],
        Moderator: [
            { title: "New Powers!", content: "You've been promoted to Moderator! You now have new abilities to help keep the chat safe." },
            { title: "Moderation", content: "You can now mute, kick, or ban users by right-clicking their name. You can also delete any message." },
            { title: "Private Branches", content: "You now have the ability to create private, invitation-only branches for focused conversations." }
        ]
    };
    let currentTutorialStep = 0;

    // --- Core Functions ---
    const showTutorial = (role) => {
        const tutorial = TUTORIALS[role];
        if (!tutorial) return;
        currentTutorialStep = 0;
        document.getElementById('tutorial-title').textContent = `New Features for: ${role}`;
        displayTutorialStep();
        tutorialModal.classList.remove('hidden');
    };

    const displayTutorialStep = () => {
        const role = state.role;
        const step = TUTORIALS[role][currentTutorialStep];
        document.getElementById('tutorial-content').innerHTML = `
            <h3 class="text-xl font-semibold">${step.title}</h3>
            <p>${step.content}</p>
        `;
        document.getElementById('tutorial-pagination').textContent = `${currentTutorialStep + 1} / ${TUTORIALS[role].length}`;
        document.getElementById('prev-tutorial-btn').style.visibility = currentTutorialStep === 0 ? 'hidden' : 'visible';
        document.getElementById('next-tutorial-btn').textContent = currentTutorialStep === TUTORIALS[role].length - 1 ? 'Finish' : 'Next';
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
            socket.auth = { username: data.username, role: data.role, nickname: data.nickname };
            socket.connect();
        } catch (error) {
            loginError.textContent = error.message;
        }
    });

    agreeTermsBtn.addEventListener('click', () => {
        socket.emit('accept-terms');
        termsModal.classList.add('hidden');
        if (state.currentUserData.lastSeenRole !== state.role) {
            showTutorial(state.role);
        }
    });

    document.getElementById('next-tutorial-btn').addEventListener('click', () => {
        if (currentTutorialStep < TUTORIALS[state.role].length - 1) {
            currentTutorialStep++;
            displayTutorialStep();
        } else {
            tutorialModal.classList.add('hidden');
            socket.emit('tutorial-seen', { role: state.role });
            state.currentUserData.lastSeenRole = state.role;
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
        document.getElementById('reply-preview').classList.add('hidden');
    });
    
    // **NEW:** Add Branch button handler
    addChannelBtn.addEventListener('click', () => {
        const channelName = prompt("Enter a name for the new branch:");
        if (channelName && channelName.trim()) {
            socket.emit('create-channel', { channelName: channelName.trim() });
        }
    });

    // **NEW:** Channel click handler
    channelsList.addEventListener('click', (e) => {
        const channelDiv = e.target.closest('[data-channel-id]');
        if (channelDiv) {
            const channelId = channelDiv.dataset.channelId;
            if (channelId !== state.currentChat.id) {
                state.currentChat = { type: 'channel', id: channelId };
                channelTitle.textContent = `# ${channelId}`;
                renderChannels(); // Re-render to update active highlight
                renderAllMessages(state.channels[channelId]?.messages || []);
            }
        }
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        state = { ...state, ...data };
        
        pages.login.classList.replace('active', 'hidden');
        pages.chat.classList.replace('hidden', 'flex');
        
        renderChannels();
        renderUsers();
        renderAllMessages(state.channels[state.currentChat.id]?.messages || []);
        channelTitle.textContent = `# ${state.currentChat.id}`;
        
        if (!state.currentUserData.hasAgreedToTerms) {
            termsModal.classList.remove('hidden');
        } else if (state.currentUserData.lastSeenRole !== state.role) {
            showTutorial(state.role);
        }
    });

    socket.on('new-message', ({ channel, message }) => {
        if (state.channels[channel]) {
            state.channels[channel].messages.push(message);
        }
        if (channel === state.currentChat.id) {
            chatWindow.appendChild(renderMessage(message));
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    });

    socket.on('update-user-list', ({ activeUsers, allUsersData }) => {
        state.activeUsers = activeUsers;
        state.allUsers = { ...state.allUsers, ...allUsersData };
        renderUsers();
    });

    // **NEW:** Handle channel updates from server
    socket.on('channels-updated', (channels) => {
        state.channels = channels;
        renderChannels();
    });

    socket.on('system-message', ({ text, type = 'error' }) => {
        // You can create a more sophisticated notification system
        alert(text); 
    });

    socket.on('connect_error', (err) => {
        console.error("Connection failed:", err.message);
        const loginError = document.getElementById('login-error');
        loginError.textContent = "Could not connect to the server.";
    });
});
