document.addEventListener('DOMContentLoaded', async () => {
    // --- Global State & Config ---
    if (typeof fpPromise === 'undefined') { console.error("FingerprintJS not loaded!"); return; }
    let HUGGING_FACE_TOKEN = null;
    try {
        const response = await fetch('/api/hf-token');
        if (response.ok) HUGGING_FACE_TOKEN = (await response.json()).token;
        else console.error("Could not fetch Hugging Face token.");
    } catch (e) { console.error("Error fetching Hugging Face token:", e); }

    const socket = io({ autoConnect: false });
    let state = { 
        username: null, role: null, nickname: null, icon: null, 
        currentChat: { type: 'channel', id: 'general' },
        allUsers: {}, activeUsers: {}, channels: {},
        securityData: { devices: [], buddy: null, buddyRequests: [], faceId: null, twoFactorEnabled: false }
    };
    let tempLoginData = null;
    let currentVisitorId = null;
    const DATA_API_URL = 'http://localhost:10000';
    let faceIdStream = null;

    // --- Element Selectors ---
    const pages = { joinCode: document.getElementById('join-code-page'), login: document.getElementById('login-page'), chat: document.getElementById('chat-page'), twoFactor: document.getElementById('two-factor-page') };
    const joinCodeForm = document.getElementById('join-code-form');
    const loginForm = document.getElementById('login-form');
    const settingsModal = document.getElementById('settings-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const unrecognizedDeviceModal = document.getElementById('unrecognized-device-modal');
    
    // 2FA Elements
    const twoFactorForm = document.getElementById('2fa-form');
    const twoFactorSetupModal = document.getElementById('2fa-setup-modal');
    const enable2faBtn = document.getElementById('enable-2fa-btn');
    const disable2faBtn = document.getElementById('disable-2fa-btn');
    const cancel2faSetupBtn = document.getElementById('cancel-2fa-setup-btn');
    const twoFactorStatusDisplay = document.getElementById('2fa-status-display');
    const twoFactorEnableUI = document.getElementById('2fa-enable-ui');
    const twoFactorEnabledUI = document.getElementById('2fa-enabled-ui');
    const qrCodeContainer = document.getElementById('2fa-qr-code');
    const secretKeyContainer = document.getElementById('2fa-secret-key');
    const setup2faForm = document.getElementById('2fa-setup-form');

    // Face ID Elements
    const faceIdModal = document.getElementById('face-id-modal');
    const faceIdVideo = document.getElementById('face-id-video');
    const faceIdStatus = document.getElementById('face-id-status');
    const faceIdOverlay = document.getElementById('face-id-overlay');
    const faceIdCancelBtn = document.getElementById('face-id-cancel-btn');
    const faceIdCaptureBtn = document.getElementById('face-id-capture-btn');
    const enrollFaceIdBtn = document.getElementById('enroll-face-id-btn');
    const removeFaceIdBtn = document.getElementById('remove-face-id-btn');
    const faceIdStatusDisplay = document.getElementById('face-id-status-display');
    const faceIdEnrollUI = document.getElementById('face-id-enroll-ui');
    const faceIdEnrolledUI = document.getElementById('face-id-enrolled-ui');

    // Security Tab Elements
    const buddySystemStatus = document.getElementById('buddy-system-status');
    const buddyRequestInput = document.getElementById('buddy-request-input');
    const sendBuddyRequestBtn = document.getElementById('send-buddy-request-btn');
    const deviceList = document.getElementById('device-list');
    const securityTabContent = document.getElementById('security-tab-content');

    // --- API Helpers ---
    const dataApi = {
        get: (endpoint) => fetch(`${DATA_API_URL}/${endpoint}`).then(res => res.ok ? res.json() : Promise.reject(res.json())),
        post: (endpoint, body) => fetch(`${DATA_API_URL}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(res => res.ok ? res.json() : Promise.reject(res.json())),
    };
    const huggingFaceApi = {
        async getEmbedding(blob) {
            if (!HUGGING_FACE_TOKEN) throw new Error("Hugging Face token not available.");
            const response = await fetch(
                "https://api-inference.huggingface.co/models/facebook/dinov2-base",
                {
                    headers: { Authorization: `Bearer ${HUGGING_FACE_TOKEN}` },
                    method: "POST",
                    body: blob,
                }
            );
            const result = await response.json();
            if (response.ok && Array.isArray(result) && result.length > 0 && result[0].blob) {
                 return result[0].blob;
            }
            throw new Error(result.error || "Failed to get face embedding from API response.");
        }
    };

    // --- Core Functions ---
    const cosineSimilarity = (vecA, vecB) => {
        if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    };
    
    // --- Webcam & Face ID Logic ---
    const startWebcam = async (videoElement) => {
        try {
            if (faceIdStream) faceIdStream.getTracks().forEach(track => track.stop());
            faceIdStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoElement.srcObject = faceIdStream;
            return true;
        } catch (err) {
            console.error("Webcam access denied:", err);
            alert("Webcam access is required for Face ID. Please enable it in your browser settings.");
            return false;
        }
    };

    const stopWebcam = () => {
        if (faceIdStream) {
            faceIdStream.getTracks().forEach(track => track.stop());
            faceIdStream = null;
        }
    };

    const captureImageBlob = (videoElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        canvas.getContext('2d').drawImage(videoElement, 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    };

    // --- Rendering Functions ---
    const renderSecuritySettings = () => {
        const has2fa = state.securityData && state.securityData.twoFactorEnabled;
        twoFactorStatusDisplay.textContent = has2fa ? 'Authenticator app is connected.' : 'Authenticator app is not connected.';
        twoFactorEnableUI.classList.toggle('hidden', has2fa);
        twoFactorEnabledUI.classList.toggle('hidden', !has2fa);

        const hasFaceId = state.securityData && state.securityData.faceId;
        faceIdStatusDisplay.textContent = hasFaceId ? 'Face ID is enabled and active.' : 'Face ID is not set up.';
        faceIdEnrollUI.classList.toggle('hidden', hasFaceId);
        faceIdEnrolledUI.classList.toggle('hidden', !hasFaceId);

        buddySystemStatus.innerHTML = '';
        if (state.securityData.buddy) {
            buddySystemStatus.innerHTML = `<p class="dark:text-gray-300">Your buddy is <strong>${state.securityData.buddy}</strong>.</p>`;
        } else if (state.securityData.buddyRequests && state.securityData.buddyRequests.length > 0) {
            const request = state.securityData.buddyRequests[0];
            buddySystemStatus.innerHTML = `
                <div class="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                    <p class="dark:text-blue-200">You have a buddy request from <strong>${request.from}</strong>.</p>
                    <div class="mt-2 flex gap-2">
                        <button class="btn-primary respond-buddy-request" data-from="${request.from}" data-action="accept">Accept</button>
                        <button class="btn-secondary respond-buddy-request" data-from="${request.from}" data-action="decline">Decline</button>
                    </div>
                </div>`;
        } else {
            buddySystemStatus.innerHTML = `<p class="text-gray-500 dark:text-gray-400">You don't have a buddy yet.</p>`;
        }

        deviceList.innerHTML = '';
        if (state.securityData.devices) {
            state.securityData.devices.forEach(device => {
                const isCurrent = device.id === currentVisitorId;
                const deviceDiv = document.createElement('div');
                deviceDiv.classList.add('flex', 'justify-between', 'items-center', 'p-2', 'bg-gray-100', 'dark:bg-gray-700', 'rounded-md');
                deviceDiv.innerHTML = `
                    <div>
                        <span class="font-semibold dark:text-white">${device.name}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400">${isCurrent ? '(This Device)' : ''}</span>
                    </div>
                    ${!isCurrent ? '<button class="btn-danger text-xs remove-device-btn" data-id="' + device.id + '">Remove</button>' : ''}
                `;
                deviceList.appendChild(deviceDiv);
            });
        }
    };

    // --- Login Flow ---
    const handleJoinAttempt = async (e) => {
        e.preventDefault();
        const joinError = document.getElementById('join-error');
        joinError.textContent = '';
        const code = document.getElementById('join-code-input').value;
        try {
            const response = await fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            if (!response.ok) throw new Error((await response.json()).message);
            pages.joinCode.classList.replace('active', 'hidden');
            pages.login.classList.replace('hidden', 'active');
        } catch (error) {
            joinError.textContent = error.message;
        }
    };
    
    const handleLoginAttempt = async (e) => {
        e.preventDefault();
        const loginError = document.getElementById('login-error');
        loginError.textContent = '';
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const loginResponse = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const loginData = await loginResponse.json();
            if (!loginResponse.ok) throw new Error(loginData.message);
            
            tempLoginData = loginData;
            state.username = username;

            try {
                state.securityData = await dataApi.get(`security/${username}`);
            } catch (err) { 
                state.securityData = { devices: [], buddy: null, buddyRequests: [], faceId: null, twoFactorEnabled: false };
            }

            if (state.securityData.twoFactorEnabled) {
                pages.login.classList.replace('active', 'hidden');
                pages.twoFactor.classList.replace('hidden', 'active');
                document.getElementById('2fa-code-input').focus();
            } else {
                await proceedWithPostPasswordAuth(loginData);
            }
        } catch (error) {
            loginError.textContent = error.message;
        }
    };

    const handle2faVerification = async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('2fa-error');
        errorEl.textContent = '';
        const code = document.getElementById('2fa-code-input').value;

        try {
            await dataApi.post('login/2fa', { username: state.username, token: code });
            await proceedWithPostPasswordAuth(tempLoginData);
        } catch (err) {
            errorEl.textContent = 'Invalid code. Please try again.';
        }
    };
    
    const proceedWithPostPasswordAuth = async (loginData) => {
        const fp = await fpPromise;
        const result = await fp.get();
        currentVisitorId = result.visitorId;

        if (state.securityData.faceId) {
            await startFaceIdVerification(loginData);
        } else {
            const isDeviceRecognized = state.securityData.devices.some(d => d.id === currentVisitorId);
            if (isDeviceRecognized || state.securityData.devices.length === 0) {
                if (state.securityData.devices.length === 0) {
                    await dataApi.post(`security/${state.username}/devices`, { id: currentVisitorId, name: 'Initial Device' });
                }
                connectToChat(loginData);
            } else {
                unrecognizedDeviceModal.classList.remove('hidden');
            }
        }
    };

    const startFaceIdVerification = async (loginData) => {
        pages.login.classList.replace('active', 'hidden');
        pages.twoFactor.classList.replace('active', 'hidden');
        faceIdModal.classList.remove('hidden');
        if (await startWebcam(faceIdVideo)) {
            faceIdOverlay.classList.add('hidden');
            faceIdCaptureBtn.onclick = async () => {
                faceIdStatus.textContent = 'Verifying...';
                faceIdOverlay.classList.remove('hidden');
                const blob = await captureImageBlob(faceIdVideo);
                try {
                    const currentEmbedding = await huggingFaceApi.getEmbedding(blob);
                    const storedEmbedding = state.securityData.faceId;
                    const similarity = cosineSimilarity(currentEmbedding, storedEmbedding);
                    
                    if (similarity >= 0.51) {
                        faceIdStatus.textContent = 'Success!';
                        setTimeout(() => {
                            stopWebcam();
                            connectToChat(loginData);
                        }, 1000);
                    } else {
                        faceIdStatus.textContent = 'Match Failed. Try again.';
                        setTimeout(() => faceIdOverlay.classList.add('hidden'), 2000);
                    }
                } catch (err) {
                    console.error("Face verification error:", err);
                    faceIdStatus.textContent = 'Error. Please try again.';
                    setTimeout(() => faceIdOverlay.classList.add('hidden'), 2000);
                }
            };
        }
    };

    const connectToChat = (loginData) => {
        unrecognizedDeviceModal.classList.add('hidden');
        faceIdModal.classList.add('hidden');
        pages.login.classList.replace('active', 'hidden');
        pages.twoFactor.classList.replace('active', 'hidden');
        socket.auth = { username: loginData.username, role: loginData.role, nickname: loginData.nickname };
        socket.connect();
    };


    // --- Event Handlers ---
    joinCodeForm.addEventListener('submit', handleJoinAttempt);
    loginForm.addEventListener('submit', handleLoginAttempt);
    twoFactorForm.addEventListener('submit', handle2faVerification);

    enable2faBtn.addEventListener('click', async () => {
        try {
            const setupData = await dataApi.post(`security/${state.username}/2fa/setup`, {});
            qrCodeContainer.innerHTML = '';
            qrCodeContainer.innerHTML = setupData.qrCode;
            secretKeyContainer.textContent = setupData.secret;
            twoFactorSetupModal.classList.remove('hidden');
        } catch (err) {
            alert('Could not start 2FA setup. Please try again later.');
        }
    });

    setup2faForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('2fa-setup-code').value;
        try {
            await dataApi.post(`security/${state.username}/2fa/verify`, { token });
            alert('2FA enabled successfully!');
            state.securityData.twoFactorEnabled = true;
            twoFactorSetupModal.classList.add('hidden');
            renderSecuritySettings();
        } catch (err) {
            alert('Verification failed. The code was incorrect. Please try again.');
        }
    });

    disable2faBtn.addEventListener('click', async () => {
        if (confirm("Are you sure you want to disable Two-Factor Authentication?")) {
            try {
                await dataApi.post(`security/${state.username}/2fa/disable`, {});
                state.securityData.twoFactorEnabled = false;
                renderSecuritySettings();
            } catch (err) {
                alert("Failed to disable 2FA.");
            }
        }
    });

    cancel2faSetupBtn.addEventListener('click', () => {
        twoFactorSetupModal.classList.add('hidden');
    });

    settingsBtn.addEventListener('click', () => { renderSecuritySettings(); settingsModal.classList.remove('hidden'); });
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    faceIdCancelBtn.addEventListener('click', () => { stopWebcam(); faceIdModal.classList.add('hidden'); });

    enrollFaceIdBtn.addEventListener('click', async () => {
        alert("Please position your face clearly in the frame for enrollment.");
        if (await startWebcam(faceIdVideo)) {
            document.getElementById('face-id-title').textContent = "Face ID Enrollment";
            faceIdCaptureBtn.textContent = "Enroll My Face";
            faceIdModal.classList.remove('hidden');
            
            faceIdCaptureBtn.onclick = async () => {
                faceIdStatus.textContent = 'Processing...';
                faceIdOverlay.classList.remove('hidden');
                const blob = await captureImageBlob(faceIdVideo);
                try {
                    const embedding = await huggingFaceApi.getEmbedding(blob);
                    await dataApi.post(`security/${state.username}/faceid`, { faceId: embedding });
                    state.securityData.faceId = embedding;
                    faceIdStatus.textContent = 'Enrolled!';
                    setTimeout(() => {
                        stopWebcam();
                        faceIdModal.classList.add('hidden');
                        renderSecuritySettings();
                    }, 1500);
                } catch (err) {
                    alert('Enrollment failed. Please try again.');
                    faceIdOverlay.classList.add('hidden');
                }
            };
        }
    });

    removeFaceIdBtn.addEventListener('click', async () => {
        if (confirm("Are you sure you want to remove Face ID?")) {
            try {
                await dataApi.post(`security/${state.username}/faceid/remove`, {});
                state.securityData.faceId = null;
                renderSecuritySettings();
            } catch (err) { alert("Failed to remove Face ID."); }
        }
    });

    sendBuddyRequestBtn.addEventListener('click', async () => {
        const buddyUsername = buddyRequestInput.value.trim();
        if (!buddyUsername) return;
        try {
            await dataApi.post(`buddy/request`, { from: state.username, to: buddyUsername });
            alert('Buddy request sent!');
            buddyRequestInput.value = '';
        } catch (err) {
            alert('Failed to send request. Make sure the username is correct.');
        }
    });

    securityTabContent.addEventListener('click', async (e) => {
        if (e.target.matches('.respond-buddy-request')) {
            const from = e.target.dataset.from;
            const action = e.target.dataset.action;
            try {
                const updatedSecurityData = await dataApi.post('buddy/respond', { to: state.username, from, action });
                state.securityData = updatedSecurityData;
                renderSecuritySettings();
            } catch (err) {
                alert('Failed to respond to request.');
            }
        }
    });

    // --- Socket Handlers ---
    socket.on('join-successful', (data) => {
        state = { ...state, ...data };
        pages.chat.classList.replace('hidden', 'flex');
        pages.login.classList.replace('active', 'hidden');
        pages.twoFactor.classList.replace('active', 'hidden');
        // Initial render calls for chat UI can go here
    });
});
