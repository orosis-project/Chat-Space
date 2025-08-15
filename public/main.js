document.addEventListener('DOMContentLoaded', async () => {
    // ... initial setup and Giphy key fetch ...
    let state = { /* ... */ };

    // --- Element Selectors ---
    const pages = { joinCode: document.getElementById('join-code-page'), login: document.getElementById('login-page'), chat: document.getElementById('chat-page') };
    const joinCodeForm = document.getElementById('join-code-form');
    // ... all other element selectors from v17 ...

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
        e.preventDefault(); // This is the crucial fix. It stops the form from reloading the page.
        handleJoinAttempt();
    });

    // ... all other event handlers and socket listeners from v17 ...
});
