// admin.js

document.addEventListener('DOMContentLoaded', () => {
    const loginPage = document.getElementById('admin-login-page');
    const dashboard = document.getElementById('admin-dashboard');
    const loginForm = document.getElementById('admin-login-form');
    const adminError = document.getElementById('admin-error');
    const roomsContainer = document.getElementById('rooms-container');
    let adminToken = null; // In a real app, this would be a JWT

    const fetchAndRenderRooms = async () => {
        try {
            const res = await fetch('/admin/data');
            const rooms = await res.json();
            roomsContainer.innerHTML = '';
            for (const roomCode in rooms) {
                const room = rooms[roomCode];
                const roomEl = document.createElement('div');
                roomEl.className = 'bg-gray-800 p-6 rounded-lg shadow-lg';
                let messagesHTML = room.messages.map(m => `
                    <div class="border-b border-gray-700 py-2">
                        <p class="text-gray-400 text-sm">${m.username} <span class="text-xs text-gray-500">${m.timestamp}</span></p>
                        <p>${m.message}</p>
                    </div>
                `).join('');

                roomEl.innerHTML = `
                    <div class="flex justify-between items-center mb-4">
                        <div>
                            <h2 class="text-2xl font-bold">${roomCode}</h2>
                            <p class="text-sm text-gray-400">Owner: ${room.owner}</p>
                        </div>
                        <button data-roomcode="${roomCode}" class="delete-room-btn bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">Delete Room</button>
                    </div>
                    <div class="bg-gray-900 p-4 rounded-md max-h-96 overflow-y-auto">
                        ${messagesHTML || '<p class="text-gray-500">No messages yet.</p>'}
                    </div>
                `;
                roomsContainer.appendChild(roomEl);
            }
        } catch (error) {
            console.error("Failed to fetch room data:", error);
        }
    };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('admin-password').value;
        try {
            const res = await fetch('/admin-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message);
            }
            loginPage.classList.add('hidden');
            dashboard.classList.remove('hidden');
            fetchAndRenderRooms();
        } catch (error) {
            adminError.textContent = error.message;
        }
    });

    roomsContainer.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-room-btn')) {
            const roomCode = e.target.dataset.roomcode;
            if (confirm(`Are you sure you want to permanently delete room "${roomCode}"? This cannot be undone.`)) {
                try {
                    const res = await fetch(`/admin/delete-room/${roomCode}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('Failed to delete room.');
                    fetchAndRenderRooms(); // Refresh the list
                } catch (error) {
                    alert(error.message);
                }
            }
        }
    });
});
