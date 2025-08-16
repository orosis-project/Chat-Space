document.addEventListener('DOMContentLoaded', async () => {
    // --- Global State & Config ---
    if (typeof fpPromise === 'undefined') { console.error("FingerprintJS not loaded!"); return; }
    
    let HUGGING_FACE_TOKEN = null;
    try {
        const response = await fetch('/api/hf-token');
        if (response.ok) HUGGING_FACE_TOKEN = (await response.json()).token;
    } catch (e) { console.error("Error fetching Hugging Face token:", e); }

    const socket = io({ autoConnect: false });
    let state = { 
        username: null, role: null, nickname: null, icon: null, 
        currentChat: { type: 'channel', id: 'general' },
        allUsers: {}, activeUsers: {}, channels: {},
        securityData: { devices: [], buddy: null, buddyRequests: [], faceId: null, twoFactorEnabled: false },
        settings: { auto_approve_users: false, redirect_new_users: false }
    };
    let tempLoginData = null;
    let currentVisitorId = null;
    let faceIdStream = null;

    // --- Element Selectors ---
    const pages = { joinCode: document.getElementById('join-code-page'), login: document.getElementById('login-page'), chat: document.getElementById('chat-page'), twoFactor: document.getElementById('two-factor-page') };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const twoFactorForm = document.getElementById('2fa-form');
    const settingsBtn = document.getElementById('settings-btn');
    const userDbBtn = document.getElementById('user-database-btn');
    const modalRoot = document.getElementById('modal-root');
    const toastContainer = document.getElementById('toast-container');
    
    // --- API & Core Helpers ---
    const api = {
        get: (endpoint) => fetch(endpoint).then(res => res.ok ? res.json() : Promise.reject(res.json())),
        post: (endpoint, body) => fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(res => res.ok ? res.json() : Promise.reject(res.json())),
    };

    const huggingFaceApi = {
        async getEmbedding(blob) {
            if (!HUGGING_FACE_TOKEN) throw new Error("Hugging Face token not available.");
            const response = await fetch("https://api-inference.huggingface.co/models/facebook/dinov2-base", {
                headers: { Authorization: `Bearer ${HUGGING_FACE_TOKEN}` }, method: "POST", body: blob,
            });
            const result = await response.json();
            if (response.ok && Array.isArray(result) && result.length > 0 && result[0].blob) return result[0].blob;
            throw new Error(result.error || "Failed to get face embedding.");
        }
    };

    const cosineSimilarity = (vecA, vecB) => {
        if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    };
    
    const startWebcam = async (videoElement) => {
        try {
            if (faceIdStream) faceIdStream.getTracks().forEach(track => track.stop());
            faceIdStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoElement.srcObject = faceIdStream;
            return true;
        } catch (err) {
            showToast("Webcam access is required for Face ID.", 'error');
            return false;
        }
    };

    const stopWebcam = () => {
        if (faceIdStream) faceIdStream.getTracks().forEach(track => track.stop());
        faceIdStream = null;
    };

    const captureImageBlob = (videoElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        canvas.getContext('2d').drawImage(videoElement, 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    };

    // --- UI Helpers ---
    const showToast = (message, type = 'info') => {
        const colors = {
            info: 'bg-blue-500',
            success: 'bg-green-500',
            error: 'bg-red-500'
        };
        const toast = document.createElement('div');
        toast.className = `toast ${colors[type]}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    };

    const openModal = (id, content) => {
        const modalContainer = document.createElement('div');
        modalContainer.id = id;
        modalContainer.className = 'modal-container';
        modalContainer.innerHTML = content;
        modalRoot.appendChild(modalContainer);

        const closeModal = () => {
            modalContainer.classList.add('fade-out');
            modalContainer.addEventListener('animationend', () => modalContainer.remove());
        };

        modalContainer.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
        modalContainer.addEventListener('click', (e) => { if (e.target === modalContainer) closeModal(); });
        return modalContainer;
    };

    // --- Login Flow ---
    const handleJoinAttempt = async (e) => {
        e.preventDefault();
        const joinError = document.getElementById('join-error');
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            await api.post('/join', { code });
            pages.joinCode.classList.replace('active', 'hidden');
            pages.login.classList.replace('hidden', 'active');
        } catch (error) {
            const err = await error;
            joinError.textContent = err.message;
        }
    };
    
    const handleLoginAttempt = async (e) => {
        e.preventDefault();
        const loginError = document.getElementById('login-error');
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const fp = await fpPromise;
        const result = await fp.get();
        currentVisitorId = result.visitorId;

        try {
            const loginData = await api.post('/login', { username, password, fingerprintId: currentVisitorId });
            
            if (loginData.status === 'pending') {
                loginError.textContent = "Your account is pending approval.";
                return;
            }

            tempLoginData = loginData;
            state.username = username;

            try {
                state.securityData = await api.get(`/security/${username}`);
            } catch (err) { 
                state.securityData = { devices: [], buddy: null, buddyRequests: [], faceId: null, twoFactorEnabled: false };
            }

            if (state.securityData.two_factor_enabled) {
                pages.login.classList.replace('active', 'hidden');
                pages.twoFactor.classList.replace('hidden', 'active');
                document.getElementById('2fa-code-input').focus();
            } else {
                await proceedWithPostPasswordAuth(loginData);
            }
        } catch (error) {
            const err = await error;
            loginError.textContent = err.message;
        }
    };

    const handle2faVerification = async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('2fa-error');
        errorEl.textContent = '';
        const code = document.getElementById('2fa-code-input').value;

        try {
            await api.post('/login/2fa', { username: state.username, token: code });
            await proceedWithPostPasswordAuth(tempLoginData);
        } catch (err) {
            errorEl.textContent = 'Invalid code. Please try again.';
        }
    };
    
    const proceedWithPostPasswordAuth = async (loginData) => {
        if (state.securityData.face_id_embedding) {
            await startFaceIdVerification(loginData);
        } else {
            const isDeviceRecognized = state.securityData.devices.some(d => d.fingerprint_id === currentVisitorId);
            if (isDeviceRecognized || state.securityData.devices.length === 0) {
                if (state.securityData.devices.length === 0) {
                    await api.post(`/security/${state.username}/devices`, { id: currentVisitorId, name: 'Initial Device' });
                }
                connectToChat(loginData);
            } else {
                openUnrecognizedDeviceModal();
            }
        }
    };

    const startFaceIdVerification = async (loginData) => {
        pages.login.classList.replace('active', 'hidden');
        pages.twoFactor.classList.replace('active', 'hidden');
        openFaceIdModal('verify', loginData);
    };

    const connectToChat = (loginData) => {
        modalRoot.innerHTML = '';
        pages.login.classList.replace('active', 'hidden');
        pages.twoFactor.classList.replace('active', 'hidden');
        socket.auth = { username: loginData.username, role: loginData.role, nickname: loginData.nickname };
        socket.connect();
    };


    // --- Event Handlers ---
    joinCodeForm.addEventListener('submit', handleJoinAttempt);
    loginForm.addEventListener('submit', handleLoginAttempt);
    twoFactorForm.addEventListener('submit', handle2faVerification);
    settingsBtn.addEventListener('click', openSettingsModal);
    userDbBtn.addEventListener('click', openUserDbModal);

    // --- Modal Opening Functions & Logic ---
    function openSettingsModal() {
        const content = `
            <div class="modal-content max-w-4xl">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold dark:text-white">Settings</h2>
                    <button class="modal-close-btn"><i class="ri-close-line"></i></button>
                </div>
                <div class="mb-4 border-b border-gray-200/10 dark:border-gray-800/50">
                    <nav class="flex space-x-1 sm:space-x-4 overflow-x-auto pb-2" aria-label="Tabs">
                        <button class="setting-tab active" data-tab="profile">Profile</button>
                        <button class="setting-tab" data-tab="security">Security</button>
                        <button class="setting-tab owner-only hidden" data-tab="user-management">User Management</button>
                    </nav>
                </div>
                <div id="profile-tab-content" class="setting-tab-content active"></div>
                <div id="security-tab-content" class="setting-tab-content hidden"></div>
                <div id="user-management-tab-content" class="setting-tab-content hidden owner-only"></div>
            </div>`;
        const modal = openModal('settings-modal', content);
        
        modal.querySelector('nav').addEventListener('click', (e) => {
            if (e.target.matches('.setting-tab')) {
                modal.querySelectorAll('.setting-tab').forEach(t => t.classList.remove('active'));
                modal.querySelectorAll('.setting-tab-content').forEach(c => c.classList.add('hidden'));
                e.target.classList.add('active');
                modal.querySelector(`#${e.target.dataset.tab}-tab-content`).classList.remove('hidden');
            }
        });

        renderProfileTab(modal.querySelector('#profile-tab-content'));
        renderSecurityTab(modal.querySelector('#security-tab-content'));
    }

    function renderProfileTab(container) {
        container.innerHTML = `
            <h3 class="text-lg font-bold dark:text-white mb-2">Edit Your Profile</h3>
            <div class="space-y-4 max-w-md">
                <div>
                    <label class="block text-sm font-medium text-gray-400">Nickname</label>
                    <input type="text" id="profile-nickname-input" class="modal-input mt-1" value="${state.nickname}">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-400">Icon URL</label>
                    <input type="text" id="profile-icon-input" class="modal-input mt-1" value="${state.icon}">
                </div>
                <button id="save-profile-btn" class="btn-primary">Save Profile</button>
            </div>`;
    }

    function renderSecurityTab(container) {
        container.innerHTML = `
            <div id="2fa-section"></div> <hr class="my-6 border-gray-200/10 dark:border-gray-800/50">
            <div id="face-id-section"></div> <hr class="my-6 border-gray-200/10 dark:border-gray-800/50">
            <div id="buddy-system-section"></div> <hr class="my-6 border-gray-200/10 dark:border-gray-800/50">
            <div id="device-management-section"></div>`;
        renderSecuritySettings();
    }

    function renderSecuritySettings() {
        const twoFactorSection = document.getElementById('2fa-section');
        if (twoFactorSection) {
            const has2fa = state.securityData && state.securityData.two_factor_enabled;
            twoFactorSection.innerHTML = `
                <h3 class="text-lg font-bold dark:text-white mb-2">Two-Factor Authentication (2FA)</h3>
                <p class="mb-2 dark:text-gray-300">${has2fa ? 'Authenticator app is connected.' : 'Authenticator app is not connected.'}</p>
                <div class="${has2fa ? 'hidden' : ''}">
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-2">Add an extra layer of security to your account.</p>
                    <button id="enable-2fa-btn" class="btn-primary">Enable 2FA</button>
                </div>
                <div class="${has2fa ? '' : 'hidden'}">
                    <p class="text-sm text-green-600 dark:text-green-400 mb-2">2FA is enabled.</p>
                    <button id="disable-2fa-btn" class="btn-danger">Disable 2FA</button>
                </div>`;
            twoFactorSection.querySelector('#enable-2fa-btn')?.addEventListener('click', open2faSetupModal);
        }
    }

    function open2faSetupModal() {
        api.post(`/security/${state.username}/2fa/setup`, {}).then(setupData => {
            const content = `
            <div class="modal-content max-w-md text-center">
                <h2 class="text-2xl font-bold mb-4 dark:text-white">Set Up 2FA</h2>
                <p class="text-gray-500 dark:text-gray-400 mb-4">Scan this with your authenticator app.</p>
                <div class="p-2 bg-white inline-block rounded-lg">${setupData.qrCode}</div>
                <p class="text-gray-500 dark:text-gray-400 text-sm mt-4">Or enter this code manually:</p>
                <p class="font-mono bg-gray-800 p-2 rounded-md inline-block my-2">${setupData.secret}</p>
                <hr class="my-4 border-gray-800/50">
                <p class="text-gray-500 dark:text-gray-400 mb-4">Enter the 6-digit code from your app to complete setup.</p>
                <form id="2fa-setup-form">
                    <input type="text" id="2fa-setup-code" placeholder="6-Digit Code" maxlength="6" class="modal-input w-full text-center tracking-[0.5em] font-bold text-xl">
                    <div class="mt-4 flex gap-2 justify-end">
                        <button type="button" class="modal-close-btn btn-secondary">Cancel</button>
                        <button type="submit" class="btn-primary">Verify & Enable</button>
                    </div>
                </form>
            </div>`;
            const modal = openModal('2fa-setup-modal', content);
            modal.querySelector('#2fa-setup-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const token = modal.querySelector('#2fa-setup-code').value;
                try {
                    await api.post(`/security/${state.username}/2fa/verify`, { token });
                    showToast('2FA enabled successfully!', 'success');
                    state.securityData.two_factor_enabled = true;
                    modalRoot.innerHTML = '';
                    openSettingsModal();
                } catch (err) {
                    showToast('Verification failed. Invalid code.', 'error');
                }
            });
        });
    }

    function openFaceIdModal(mode, loginData = null) {
        const isEnroll = mode === 'enroll';
        const title = isEnroll ? 'Face ID Enrollment' : 'Face ID Verification';
        const buttonText = isEnroll ? 'Enroll My Face' : 'Verify Me';
        const content = `
            <div class="modal-content max-w-md text-center">
                <h2 class="text-2xl font-bold mb-4 dark:text-white">${title}</h2>
                <div class="relative w-64 h-48 mx-auto bg-gray-700 rounded-lg overflow-hidden">
                    <video id="face-id-video" class="w-full h-full object-cover" autoplay playsinline></video>
                    <div id="face-id-overlay" class="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-semibold hidden">
                        <span id="face-id-status"></span>
                    </div>
                </div>
                <p class="text-gray-400 my-4">Position your face in the frame.</p>
                <button id="face-id-capture-btn" class="btn-primary w-full">${buttonText}</button>
                <button class="modal-close-btn btn-secondary w-full mt-2">Cancel</button>
            </div>`;
        const modal = openModal('face-id-modal', content);

        const videoEl = modal.querySelector('#face-id-video');
        const captureBtn = modal.querySelector('#face-id-capture-btn');
        const statusOverlay = modal.querySelector('#face-id-overlay');
        const statusText = modal.querySelector('#face-id-status');

        startWebcam(videoEl).then(success => {
            if (success) {
                captureBtn.onclick = async () => {
                    statusText.textContent = isEnroll ? 'Processing...' : 'Verifying...';
                    statusOverlay.classList.remove('hidden');
                    const blob = await captureImageBlob(videoEl);
                    try {
                        const embedding = await huggingFaceApi.getEmbedding(blob);
                        if (isEnroll) {
                            await api.post(`/security/${state.username}/faceid`, { faceId: embedding });
                            state.securityData.face_id_embedding = embedding;
                            statusText.textContent = 'Enrolled!';
                        } else {
                            const similarity = cosineSimilarity(embedding, state.securityData.face_id_embedding);
                            if (similarity >= 0.51) {
                                statusText.textContent = 'Success!';
                                setTimeout(() => connectToChat(loginData), 1000);
                                return;
                            } else {
                                throw new Error('Match Failed');
                            }
                        }
                        setTimeout(() => { modalRoot.innerHTML = ''; openSettingsModal(); }, 1500);
                    } catch (err) {
                        statusText.textContent = isEnroll ? 'Enrollment Failed' : 'Match Failed';
                        setTimeout(() => statusOverlay.classList.add('hidden'), 2000);
                    }
                };
            }
        });
        modal.addEventListener('click', (e) => { if(e.target === modal) stopWebcam(); });
        modal.querySelector('.modal-close-btn').addEventListener('click', stopWebcam);
    }
    
    function openUnrecognizedDeviceModal() {
        const content = `
            <div class="modal-content max-w-md text-center">
                <i class="ri-device-recover-line ri-4x text-yellow-500 mb-4"></i>
                <h2 class="text-2xl font-bold mb-4 dark:text-white">Unrecognized Device</h2>
                <p class="text-gray-400 mb-6">For your security, please approve this login.</p>
                <div class="space-y-3">
                    <button id="ask-buddy-btn" class="btn-primary w-full">Ask my Buddy for help</button>
                    <button id="ask-owner-btn" class="btn-secondary w-full">Ask an Owner for help</button>
                </div>
            </div>`;
        openModal('unrecognized-device-modal', content);
    }

    async function openUserDbModal() {
        const content = `
            <div class="modal-content max-w-2xl">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold dark:text-white">User Database</h2>
                    <button class="modal-close-btn"><i class="ri-close-line"></i></button>
                </div>
                <div id="pending-requests-section" class="mb-6"></div>
                <h3 class="text-lg font-bold dark:text-white mb-2">All Users</h3>
                <input type="text" id="user-db-search" placeholder="Search users..." class="modal-input mb-4">
                <div id="user-db-list" class="max-h-96 overflow-y-auto"></div>
            </div>`;
        const modal = openModal('user-database-modal', content);
        await renderPendingRequests(modal.querySelector('#pending-requests-section'));
    }

    async function renderPendingRequests(container) {
        try {
            const requests = await api.get('/users/pending');
            if (requests.length === 0) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = `<h3 class="text-lg font-bold dark:text-white mb-2 text-yellow-400">Pending Requests</h3>`;
            requests.forEach(req => {
                const reqDiv = document.createElement('div');
                reqDiv.className = 'flex items-center justify-between p-2 rounded-lg bg-yellow-500/10';
                reqDiv.innerHTML = `
                    <span class="font-semibold text-yellow-300">${req.username}</span>
                    <div>
                        <button class="approve-request-btn p-1 text-green-400 hover:bg-green-500/20 rounded-full" data-username="${req.username}"><i class="ri-check-line"></i></button>
                        <button class="deny-request-btn p-1 text-red-400 hover:bg-red-500/20 rounded-full" data-username="${req.username}"><i class="ri-close-line"></i></button>
                    </div>`;
                container.appendChild(reqDiv);
            });
            container.addEventListener('click', handleApprovalClick);
        } catch (err) {
            console.error("Failed to fetch pending requests:", err);
        }
    }

    async function handleApprovalClick(e) {
        const approveBtn = e.target.closest('.approve-request-btn');
        const denyBtn = e.target.closest('.deny-request-btn');
        if (!approveBtn && !denyBtn) return;
        
        const username = approveBtn ? approveBtn.dataset.username : denyBtn.dataset.username;
        const action = approveBtn ? 'approve' : 'deny';

        try {
            await api.post(`/users/${username}/status`, { action });
            showToast(`User ${username} has been ${action}d.`, 'success');
            openUserDbModal();
        } catch (err) {
            showToast(`Failed to ${action} user.`, 'error');
        }
    }

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        state = { ...state, ...data };
        pages.chat.classList.replace('hidden', 'flex');
        pages.login.classList.replace('active', 'hidden');
        pages.twoFactor.classList.replace('active', 'hidden');
    });

    socket.on('notification', (data) => {
        showToast(data.message, data.type);
        if (data.event === 'new_user_request' && document.getElementById('user-database-modal')) {
            openUserDbModal();
        }
    });
});
