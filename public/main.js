document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ autoConnect: false });
    let state = { username: null, role: null, currentChannel: 'general' };

    // --- Element Selectors ---
    const pages = {
        joinCode: document.getElementById('join-code-page'),
        login: document.getElementById('login-page'),
        chat: document.getElementById('chat-page'),
    };
    const settingsModal = document.getElementById('settings-modal');
    const pollModal = document.getElementById('poll-modal');

    // Forms
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const messageForm = document.getElementById('message-form');
    const pollForm = document.getElementById('poll-form');

    // Buttons
    const createPollBtn = document.getElementById('create-poll-btn');
    const addPollOptionBtn = document.getElementById('add-poll-option-btn');
    const setBackgroundBtn = document.getElementById('set-background-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const closePollBtn = document.getElementById('close-poll-btn');

    // Display Areas
    const chatBackground = document.getElementById('chat-background');
    const joinError = document.getElementById('join-error');
    const loginError = document.getElementById('login-error');
    const chatWindow = document.getElementById('chat-window');
    const userListContainer = document.getElementById('user-list-container');
    const ownerSettings = document.getElementById('owner-settings');

    // --- Core Functions ---
    const showPage = (pageName) => {
        Object.values(pages).forEach(p => p.classList.replace('active', 'hidden') || p.classList.add('hidden'));
        pages[pageName].classList.replace('hidden', 'active');
    };
    
    const toggleModal = (modal, show) => {
        if (show) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        } else {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    };

    const renderMessage = (msg, channel) => {
        if (channel !== state.currentChannel) return;
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('p-3', 'rounded-lg', 'mb-3', 'flex', 'items-start', 'gap-3');
        const parsedContent = marked.parse(msg.content);
        msgDiv.innerHTML = `
            <div class="w-10 h-10 rounded-full bg-gray-300 flex-shrink-0"></div> <!-- Placeholder for icon -->
            <div>
                <p class="font-bold dark:text-white">${msg.author} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">${new Date(msg.timestamp).toLocaleTimeString()}</span></p>
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
        
        let optionsHtml = Object.keys(poll.options).map(option => `
            <button data-poll-id="${poll.id}" data-option="${option}" class="poll-option-btn block w-full text-left p-2 mt-2 rounded-md bg-white dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600">
                ${option} <span class="text-sm text-gray-500 dark:text-gray-400">(0 votes)</span>
            </button>
        `).join('');

        pollDiv.innerHTML = `
            <p class="font-bold dark:text-white">${poll.author} started a poll:</p>
            <p class="my-2 text-lg dark:text-gray-200">${poll.question}</p>
            <div class="poll-options">${optionsHtml}</div>
        `;
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
            userDiv.innerHTML = `
                <div class="w-8 h-8 rounded-full bg-gray-400"></div>
                <div>
                    <p class="font-semibold dark:text-white">${username}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">${data.role}</p>
                </div>
            `;
            userListContainer.appendChild(userDiv);
        });
    };

    // --- Event Handlers ---
    const handleJoinCode = async (e) => {
        e.preventDefault();
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            const response = await fetch('/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            showPage('login');
        } catch (error) {
            joinError.textContent = error.message;
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            
            state.username = data.username;
            state.role = data.role;
            socket.connect(); // Connect to socket.io after successful login
            socket.emit('user-connect', { username: state.username, role: state.role });
        } catch (error) {
            loginError.textContent = error.message;
        }
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
        const options = Array.from(document.querySelectorAll('input[name="poll-option"]'))
                             .map(input => input.value.trim())
                             .filter(Boolean);
        if (question && options.length >= 2) {
            socket.emit('create-poll', { channel: state.currentChannel, question, options });
            toggleModal(pollModal, false);
            pollForm.reset();
            // Reset to 2 options
            const container = document.getElementById('poll-options-container');
            while (container.children.length > 2) {
                container.removeChild(container.lastChild);
            }
        }
    };

    const handleSetBackground = () => {
        const url = document.getElementById('background-url-input').value;
        socket.emit('set-background', { url });
    };

    // --- Event Listeners ---
    joinCodeForm.addEventListener('submit', handleJoinCode);
    loginForm.addEventListener('submit', handleLogin);
    messageForm.addEventListener('submit', handleSendMessage);
    pollForm.addEventListener('submit', handleCreatePoll);
    
    settingsBtn.addEventListener('click', () => toggleModal(settingsModal, true));
    closeSettingsBtn.addEventListener('click', () => toggleModal(settingsModal, false));
    createPollBtn.addEventListener('click', () => toggleModal(pollModal, true));
    closePollBtn.addEventListener('click', () => toggleModal(pollModal, false));

    addPollOptionBtn.addEventListener('click', () => {
        const container = document.getElementById('poll-options-container');
        if (container.children.length < 10) { // Limit options
            const input = document.createElement('input');
            input.type = 'text';
            input.name = 'poll-option';
            input.placeholder = `Option ${container.children.length + 1}`;
            input.className = 'w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 dark:text-white rounded-lg';
            container.appendChild(input);
        }
    });

    setBackgroundBtn.addEventListener('click', handleSetBackground);

    chatWindow.addEventListener('click', (e) => {
        const target = e.target.closest('.poll-option-btn');
        if (target) {
            const { pollId, option } = target.dataset;
            socket.emit('vote-poll', { channel: state.currentChannel, pollId, option });
            // Disable buttons after voting
            target.closest('.poll-options').querySelectorAll('button').forEach(btn => btn.disabled = true);
            target.classList.add('bg-green-300', 'dark:bg-green-700');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === '`') {
            e.preventDefault();
            window.location.href = 'https://classroom.google.com';
        }
        if (e.key === '~' && (state.role === 'Owner' || state.role === 'Co-Owner')) {
            e.preventDefault();
            socket.emit('force-redirect');
        }
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        showPage('chat');
        if (data.settings.backgroundUrl) {
            chatBackground.style.backgroundImage = `url(${data.settings.backgroundUrl})`;
        }
        // Render existing messages for the general channel
        chatWindow.innerHTML = '';
        const generalMessages = data.channels.general.messages;
        generalMessages.forEach(msg => renderMessage(msg, 'general'));

        if (state.role === 'Owner') {
            ownerSettings.style.display = 'block';
        }
    });

    socket.on('background-updated', (url) => {
        chatBackground.style.backgroundImage = `url(${url})`;
    });

    socket.on('redirect-all', (url) => {
        window.location.href = url;
    });

    socket.on('new-message', ({ channel, message }) => renderMessage(message, channel));
    socket.on('new-poll', ({ channel, poll }) => renderPoll(poll, channel));
    socket.on('system-message', renderSystemMessage);
    socket.on('update-user-list', updateUserList);
    
    socket.on('poll-voted', ({ channel, pollId, option, voter }) => {
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
