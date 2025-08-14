document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ autoConnect: false });
    let state = { username: null, role: null, nickname: null, icon: null, currentChannel: 'general', allUsers: {}, roles: {} };

    // --- Element Selectors ---
    const pages = { joinCode: document.getElementById('join-code-page'), login: document.getElementById('login-page'), chat: document.getElementById('chat-page'), };
    const settingsModal = document.getElementById('settings-modal');
    const pollModal = document.getElementById('poll-modal');
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const messageForm = document.getElementById('message-form');
    const pollForm = document.getElementById('poll-form');
    const profileSettingsForm = document.getElementById('profile-settings-form');
    const adminUserForm = document.getElementById('admin-user-form');
    const createPollBtn = document.getElementById('create-poll-btn');
    const addPollOptionBtn = document.getElementById('add-poll-option-btn');
    const setBackgroundBtn = document.getElementById('set-background-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const closePollBtn = document.getElementById('close-poll-btn');
    const addChannelBtn = document.getElementById('add-channel-btn');
    const chatBackground = document.getElementById('chat-background');
    const joinError = document.getElementById('join-error');
    const loginError = document.getElementById('login-error');
    const chatWindow = document.getElementById('chat-window');
    const userListContainer = document.getElementById('user-list-container');
    const ownerSettings = document.getElementById('owner-settings');
    const channelsList = document.getElementById('channels-list');
    const channelTitle = document.getElementById('channel-title');
    const profileNicknameInput = document.getElementById('profile-nickname-input');
    const profileIconInput = document.getElementById('profile-icon-input');
    const adminUserSelect = document.getElementById('admin-user-select');
    const adminNicknameInput = document.getElementById('admin-nickname-input');
    const adminIconInput = document.getElementById('admin-icon-input');
    const adminRoleSelect = document.getElementById('admin-role-select');

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => p.classList.replace('active', 'hidden') || p.classList.add('hidden'));
        pages[pageName].classList.replace('hidden', 'active');
    };
    
    const toggleModal = (modal, show) => {
        modal.classList.toggle('hidden', !show);
        modal.classList.toggle('flex', show);
    };

    const requestNotificationPermission = async () => {
        if (!("Notification" in window)) {
            console.log("This browser does not support desktop notification");
        } else if (Notification.permission !== "denied") {
            await Notification.requestPermission();
        }
    };

    const showNotification = (title, body, icon) => {
        if (document.hidden && Notification.permission === "granted") {
            new Notification(title, { body, icon });
        }
    };

    const renderMessage = (msg, channel) => {
        if (channel !== state.currentChannel) return;
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('p-3', 'rounded-lg', 'mb-3', 'flex', 'items-start', 'gap-3');
        const parsedContent = marked.parse(msg.content);
        const userIcon = msg.icon && msg.icon !== 'default' ? `<img src="${msg.icon}" class="w-10 h-10 rounded-full object-cover">` : `<div class="w-10 h-10 rounded-full bg-gray-400 flex-shrink-0"></div>`;
        msgDiv.innerHTML = `
            ${userIcon}
            <div>
                <p class="font-bold dark:text-white">${msg.nickname || msg.author} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">${new Date(msg.timestamp).toLocaleTimeString()}</span></p>
                <div class="prose prose-sm dark:prose-invert max-w-none">${parsedContent}</div>
            </div>
        `;
        chatWindow.appendChild(msgDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };
    
    const renderPoll = (poll, channel) => {
        if (channel !== state.currentChannel) return;
        const pollDiv = document.createElement('div');
        pollDiv.id = `poll-${poll.id}`;
        pollDiv.classList.add('p-4', 'rounded-lg', 'mb-3', 'bg-blue-100', 'dark:bg-blue-900/50', 'border', 'border-blue-200', 'dark:border-blue-800');
        let optionsHtml = Object.keys(poll.options).map(option => `<button data-poll-id="${poll.id}" data-option="${option}" class="poll-option-btn block w-full text-left p-2 mt-2 rounded-md bg-white dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 dark:text-white"> ${option} <span class="text-sm text-gray-500 dark:text-gray-400">(0 votes)</span></button>`).join('');
        pollDiv.innerHTML = `<p class="font-bold dark:text-white">${poll.author} started a poll:</p><p class="my-2 text-lg dark:text-gray-200">${poll.question}</p><div class="poll-options">${optionsHtml}</div>`;
        chatWindow.appendChild(pollDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    const renderSystemMessage = ({ text, channel }) => {
        if (channel !== state.currentChannel) return;
        const sysMsgDiv = document.createElement('div');
        sysMsgDiv.classList.add('text-center', 'text-sm', 'text-gray-500', 'dark:text-gray-400', 'my-2', 'italic');
        sysMsgDiv.textContent = text;
        chatWindow.appendChild(sysMsgDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

    const updateUserList = (users) => {
        userListContainer.innerHTML = '';
        Object.entries(users).forEach(([username, data]) => {
            const userDiv = document.createElement('div');
            userDiv.classList.add('flex', 'items-center', 'gap-3', 'p-2', 'rounded-lg', 'hover:bg-gray-300', 'dark:hover:bg-gray-700');
            const userIcon = data.icon && data.icon !== 'default' ? `<img src="${data.icon}" class="w-8 h-8 rounded-full object-cover">` : `<div class="w-8 h-8 rounded-full bg-gray-400"></div>`;
            userDiv.innerHTML = `${userIcon}<div><p class="font-semibold dark:text-white">${data.nickname || username}</p><p class="text-xs text-gray-500 dark:text-gray-400">${data.role}</p></div>`;
            userListContainer.appendChild(userDiv);
        });
    };

    const updateChannelsList = (channels) => {
        channelsList.innerHTML = '';
        Object.keys(channels).forEach(name => {
            const link = document.createElement('a');
            link.href = '#';
            link.className = 'channel-link flex items-center gap-3 p-3 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700 transition';
            link.dataset.channel = name;
            link.innerHTML = `<i class="ri-hashtag dark:text-white"></i><span class="font-semibold dark:text-white">${name}</span>`;
            if (name === state.currentChannel) {
                link.classList.add('active');
            }
            channelsList.appendChild(link);
        });
    };
    
    const switchChannel = (channelName) => {
        if (channelName === state.currentChannel) return;
        state.currentChannel = channelName;
        document.querySelectorAll('.channel-link').forEach(link => link.classList.remove('active'));
        document.querySelector(`.channel-link[data-channel="${channelName}"]`).classList.add('active');
        channelTitle.textContent = `# ${channelName}`;
        chatWindow.innerHTML = '';
        socket.emit('get-channel-history', channelName);
    };

    const populateAdminForm = () => {
        const selectedUser = adminUserSelect.value;
        if (!selectedUser) return;
        const userData = state.allUsers[selectedUser];
        const userRole = state.roles[selectedUser];
        adminNicknameInput.value = userData.nickname || '';
        adminIconInput.value = userData.icon || '';
        adminRoleSelect.value = userRole || 'Member';
    };

    // --- Event Handlers ---
    const handleJoinCode = async (e) => {
        e.preventDefault();
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            const response = await fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            if (!response.ok) { const data = await response.json(); throw new Error(data.message); }
            showPage('login');
        } catch (error) { joinError.textContent = error.message; }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        try {
            const response = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            state.username = data.username;
            state.role = data.role;
            state.nickname = data.nickname;
            socket.connect();
            socket.emit('user-connect', { username: state.username, role: state.role, nickname: state.nickname });
        } catch (error) { loginError.textContent = error.message; }
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        if (message) {
            socket.emit('send-message', { channel: state.currentChannel, message });
            messageInput.value = '';
        }
    };
    
    const handleCreatePoll = (e) => {
        e.preventDefault();
        const question = document.getElementById('poll-question').value;
        const options = Array.from(document.querySelectorAll('input[name="poll-option"]')).map(input => input.value.trim()).filter(Boolean);
        if (question && options.length >= 2) {
            socket.emit('create-poll', { channel: state.currentChannel, question, options });
            toggleModal(pollModal, false);
            pollForm.reset();
            const container = document.getElementById('poll-options-container');
            while (container.children.length > 2) container.removeChild(container.lastChild);
        }
    };

    const handleProfileUpdate = (e) => {
        e.preventDefault();
        const nickname = profileNicknameInput.value;
        const icon = profileIconInput.value;
        socket.emit('update-profile', { nickname, icon });
        toggleModal(settingsModal, false);
    };

    const handleAdminUserUpdate = (e) => {
        e.preventDefault();
        const targetUser = adminUserSelect.value;
        const nickname = adminNicknameInput.value;
        const icon = adminIconInput.value;
        const role = adminRoleSelect.value;
        socket.emit('admin-update-user', { targetUser, nickname, icon, role });
    };

    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);
    messageForm.addEventListener('submit', handleSendMessage);
    pollForm.addEventListener('submit', handleCreatePoll);
    profileSettingsForm.addEventListener('submit', handleProfileUpdate);
    adminUserForm.addEventListener('submit', handleAdminUserUpdate);
    
    settingsBtn.addEventListener('click', () => {
        profileNicknameInput.value = state.nickname;
        profileIconInput.value = state.icon;
        if (state.role === 'Owner') {
            ownerSettings.style.display = 'block';
            adminUserSelect.innerHTML = Object.keys(state.allUsers).map(u => `<option value="${u}">${u}</option>`).join('');
            populateAdminForm();
        }
        toggleModal(settingsModal, true);
    });
    closeSettingsBtn.addEventListener('click', () => toggleModal(settingsModal, false));
    createPollBtn.addEventListener('click', () => toggleModal(pollModal, true));
    closePollBtn.addEventListener('click', () => toggleModal(pollModal, false));
    adminUserSelect.addEventListener('change', populateAdminForm);

    addChannelBtn.addEventListener('click', () => {
        const channelName = prompt('Enter new channel name:');
        if (channelName) {
            const sanitizedName = channelName.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
            if (sanitizedName) {
                socket.emit('create-channel', { channelName: sanitizedName });
            }
        }
    });

    channelsList.addEventListener('click', (e) => {
        const link = e.target.closest('.channel-link');
        if (link) {
            e.preventDefault();
            switchChannel(link.dataset.channel);
        }
    });

    addPollOptionBtn.addEventListener('click', () => {
        const container = document.getElementById('poll-options-container');
        if (container.children.length < 10) {
            const input = document.createElement('input');
            input.type = 'text';
            input.name = 'poll-option';
            input.placeholder = `Option ${container.children.length + 1}`;
            input.className = 'w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 dark:text-white rounded-lg';
            container.appendChild(input);
        }
    });

    setBackgroundBtn.addEventListener('click', () => socket.emit('set-background', { url: document.getElementById('background-url-input').value }));

    chatWindow.addEventListener('click', (e) => {
        const target = e.target.closest('.poll-option-btn');
        if (target) {
            const { pollId, option } = target.dataset;
            socket.emit('vote-poll', { channel: state.currentChannel, pollId, option });
            target.closest('.poll-options').querySelectorAll('button').forEach(btn => btn.disabled = true);
            target.classList.add('bg-green-300', 'dark:bg-green-700');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; // Ignore keydowns in inputs
        if (e.key === '`') { 
            e.preventDefault(); 
            window.location.href = 'https://classroom.google.com/'; 
        }
        if (e.key === '~' && (state.role === 'Owner' || state.role === 'Co-Owner')) { 
            e.preventDefault(); 
            socket.emit('force-redirect'); 
        }
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        showPage('chat');
        requestNotificationPermission(); // Ask for permission on join
        state.allUsers = data.allUsers;
        state.roles = data.roles;
        state.nickname = data.currentUser.nickname;
        state.icon = data.currentUser.icon;
        if (data.settings.backgroundUrl) chatBackground.style.backgroundImage = `url(${data.settings.backgroundUrl})`;
        updateChannelsList(data.channels);
        switchChannel('general');
    });

    socket.on('channel-history', ({ channel, messages }) => {
        if (channel === state.currentChannel) {
            messages.forEach(msg => renderMessage(msg, channel));
        }
    });

    socket.on('channels-updated', updateChannelsList);
    socket.on('profile-updated', ({ nickname, icon }) => { state.nickname = nickname; state.icon = icon; });
    socket.on('force-update-profile', ({ nickname, icon, role }) => { state.nickname = nickname; state.icon = icon; state.role = role; });
    socket.on('background-updated', (url) => { chatBackground.style.backgroundImage = `url(${url})`; });
    socket.on('redirect-all', (url) => { window.location.href = url; });
    
    socket.on('new-message', ({ channel, message }) => {
        renderMessage(message, channel);
        // Show notification if the message is not from the current user and is in the current channel
        if (message.author !== state.username && channel === state.currentChannel) {
            showNotification(`${message.nickname || message.author} says:`, message.content, message.icon);
        }
    });

    socket.on('new-poll', ({ channel, poll }) => renderPoll(poll, channel));
    socket.on('system-message', renderSystemMessage);
    socket.on('update-user-list', updateUserList);
    
    socket.on('poll-voted', ({ channel, pollId, option }) => {
        if (channel !== state.currentChannel) return;
        const pollElem = document.getElementById(`poll-${pollId}`);
        if (pollElem) {
            const optionBtn = pollElem.querySelector(`button[data-option="${option}"]`);
            const span = optionBtn.querySelector('span');
            const currentVotes = parseInt(span.textContent.match(/\d+/)[0]);
            span.textContent = `(${currentVotes + 1} votes)`;
        }
    });

    // --- Initial Load ---
    showPage('joinCode');
});
