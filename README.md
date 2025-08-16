Chat Space: The Definitive Edition
Welcome to Chat Space, a feature-rich, real-time chat application engineered for security, performance, and a sleek user experience. Built with a robust Node.js and PostgreSQL backend, this application provides a persistent, single-room chat environment with a powerful suite of modern security and moderation tools.

Core Chat Features
Real-Time Messaging: Instantaneous communication powered by Socket.IO.

Public & Private Branches: Create public channels for everyone or private, invitation-only branches for focused discussions.

Direct Messaging: Initiate secure, one-on-one conversations with any other user.

Typing Indicators: See when other users are actively composing a message in the current channel.

GIPHY Integration: Liven up conversations by searching for and sending GIFs directly in the chat.

Markdown Support: Format your messages with Markdown for bold, italics, code blocks, and more.

Advanced Security Suite
Chat Space is built with a multi-layered security architecture to protect user accounts and ensure a safe environment.

Account Approval System: New user registrations are not automatically accepted. An Owner or Co-Owner must approve each new account request from the User Database panel, preventing unauthorized access.

Device Fingerprinting (Computer Recognition): The application creates a unique, secure fingerprint for each user's device. Logins from unrecognized devices are flagged and require approval via the Buddy System or an Owner.

Fingerprint-Based Banning: When a user is banned, their device's unique fingerprint is also banned for the specified duration, preventing them from simply creating a new account on the same machine.

Two-Factor Authentication (2FA): Users can enable 2FA in their security settings, requiring a time-based, 6-digit code from an authenticator app (like Google Authenticator or Authy) to log in.

Face ID Verification: For the highest level of security, users can enroll their face via their webcam. Subsequent logins will require a quick facial scan to verify their identity.

Buddy System: Users can pair their account with a trusted "buddy." If a user is locked out or attempts to log in from a new device, they can request approval from their buddy to regain access.

User & Role Management
Comprehensive Role System:

Owner: The highest authority with all permissions.

Co-Owner: Has the same powers as the Owner.

Moderator: Can manage channels and use moderation tools.

Member: The default role for all new, approved users.

User Database: A central hub for viewing all registered users, whether they are online or offline. Owners can manage pending account requests directly from this panel.

Owner & Admin Controls
User Management Panel: A dedicated section in the settings for Owners to approve or deny pending user account requests.

Global Chat Settings:

Auto Approve New Users: A toggle (default off) that allows Owners to switch between the manual approval system and automatic approval for all new accounts.

Redirect New Users: An optional setting (default off) that can redirect first-time visitors to an external URL, such as classroom.google.com.

Customization & UI/UX
Sleek, Modern Interface: A clean, "Apple-ish" dark mode UI designed for a smooth and intuitive user experience.

Profile Customization: Users can personalize their identity by setting a custom nickname and profile icon URL.

Real-Time Notifications: Receive non-intrusive, real-time toast notifications for important events like new buddy requests or pending user approvals.

Responsive Design: The interface is fully responsive and works seamlessly on both desktop and mobile devices.

Technology Stack
Backend: Node.js, Express.js

Database: PostgreSQL (for persistent data storage)

Real-Time Engine: Socket.IO

Security: bcrypt, Speakeasy (for 2FA), FingerprintJS

AI: Hugging Face (for Face ID embeddings)

Frontend: HTML, Tailwind CSS, Vanilla JavaScript

Setup & Deployment
Environment Variables
To run the application, you must set the following environment variables in your hosting service (e.g., Render):

DATABASE_URL: The internal connection URL for your PostgreSQL database.

HUGGING_FACE_TOKEN: Your read-only API token from Hugging Face.

GIPHY_API_KEY: Your API key from the GIPHY Developer Portal.

Build and Start Commands
Build Command: npm install

Start Command: node server.js
