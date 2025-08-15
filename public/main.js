document.addEventListener('DOMContentLoaded', async () => {
    // ... initial setup and Giphy key fetch ...
    let state = { /* ... */ };

    // --- Element Selectors ---
    const termsModal = document.getElementById('terms-modal');
    const agreeTermsBtn = document.getElementById('agree-terms-btn');
    const tutorialModal = document.getElementById('tutorial-modal');

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
        // Add tutorials for Co-Owner and Owner if desired
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
        }
    });
    // ... other tutorial button listeners

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        state = { ...state, ...data.currentUser, ...data };
        pages.login.classList.replace('active', 'hidden');
        pages.chat.classList.replace('hidden', 'flex');
        
        if (!state.currentUserData.hasAgreedToTerms) {
            termsModal.classList.remove('hidden');
        } else if (state.currentUserData.lastSeenRole !== state.role) {
            showTutorial(state.role);
        }
        
        // ... rest of join logic
    });
});
