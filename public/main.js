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
    // ... all other element selectors from v18 ...

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
    joinCodeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        // ... join code logic from v18 ...
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // ... login logic from v18 ...
    });

    agreeTermsBtn.addEventListener('click', () => {
        socket.emit('accept-terms');
        termsModal.classList.add('hidden');
        // After agreeing, check if a tutorial for their current role needs to be shown.
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
            state.currentUserData.lastSeenRole = state.role; // Update state locally immediately
        }
    });
    // ... other tutorial button listeners

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        // This is the critical fix: set the state first, then check for onboarding.
        state = { ...state, ...data.currentUser, ...data };
        
        pages.login.classList.replace('active', 'hidden');
        pages.chat.classList.replace('hidden', 'flex');
        
        // Now that the state is fully updated, perform the checks.
        if (!state.currentUserData.hasAgreedToTerms) {
            termsModal.classList.remove('hidden');
        } else if (state.currentUserData.lastSeenRole !== state.role) {
            showTutorial(state.role);
        }
        
        // ... rest of join logic from v18 ...
    });

    // ... all other socket handlers and functions from v18 ...
});
