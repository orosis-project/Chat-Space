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

            // **FIX:** Set the auth object. This data will be sent automatically upon connection.
            socket.auth = { username: data.username, role: data.role, nickname: data.nickname };
            
            // **FIX:** Now, connect. The server will receive the auth data and send back 'join-successful'.
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
    
    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        // Populate the client state with all the data from the server
        state = { ...state, ...data };
        
        // Switch from the login page to the main chat interface
        pages.login.classList.replace('active', 'hidden');
        pages.chat.classList.replace('hidden', 'flex');
        
        // Show terms or tutorial modals if needed
        if (!state.currentUserData.hasAgreedToTerms) {
            termsModal.classList.remove('hidden');
        } else if (state.currentUserData.lastSeenRole !== state.role) {
            showTutorial(state.role);
        }

        // TODO: Add logic here to render the initial channels, users, and messages
        // from the 'state' object.
    });

    socket.on('connect_error', (err) => {
        console.error("Connection failed:", err.message);
        const loginError = document.getElementById('login-error');
        loginError.textContent = "Could not connect to the server.";
    });
});
