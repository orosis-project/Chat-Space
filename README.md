minnit.chat Clone: A Secure & Interactive Chat Application
This project is a full-stack, real-time chat application inspired by the features of minnit.chat. It is designed with a focus on a clean, interactive user interface and a multi-layered security system.

Features Overview
Real-Time Messaging: Instant messaging using Socket.IO.

Giphy Integration: Search for and send animated GIFs.

Polls: Create and vote on real-time polls.

User List: See a list of all connected users.

Authentication & Security:

Join Code: A secret HMS code is required for initial access.

Multi-Step Login: A staged login process with additional security checks.

2FA (Simulated): A system for implementing Two-Factor Authentication using an authenticator app.

Device Verification (Simulated): Identifies and remembers known devices using FingerprintJS.

Face ID (Simulated): A framework for facial verification using a Hugging Face model.

Buddy System (Simulated): A system for a trusted user to grant access.

Owner & Admin Controls:

Comprehensive Security Dashboard and event logs.

Proactive Threat Detection and alerts for suspicious activity.

IP Address Controls to block or allow specific IPs.

Emergency Lockdown System to restrict access.

Account Approval System for new user registrations.

HeimBot 🤖: An automated bot with fun and utility commands.

DM's: A private messaging system for one-on-one conversations.

Project Structure
server.js: The backend server using Node.js, Express, and Socket.IO. It manages all application logic, authentication, and real-time communication.

index.html: The main HTML file that serves as the single-page application entry point.

style.css: All CSS styling for a modern, clean, and interactive UI.

main.js: The frontend JavaScript that handles all client-side logic, UI updates, and communication with the server.

package.json: Lists all required Node.js dependencies.

Deployment on Render
This application is configured for deployment on the Render platform.

Build Command: No build command is necessary as Render will automatically run npm install.

Start Command: node server.js

Setup Instructions (for Local Development)
Clone the Repository: Create a new folder on your machine and place all the files inside.

Install Dependencies: Open a terminal in the project directory and run:

npm install


Set Up Environment Variables: The server.js file expects two environment variables for the Giphy and Hugging Face APIs. Create a file named .env in the same directory as server.js and add your keys:

GIPHY_API_KEY="YOUR_GIPHY_API_KEY"
HUGGING_FACE_TOKEN="YOUR_HUGGING_FACE_TOKEN"


Note: The code includes a fallback if these are not set, but the features will be simulated.

Run the Server: In your terminal, run the following command:

node server.js


Access the App: Open your web browser and navigate to http://localhost:3000.

Owner Credentials
The owner account is pre-configured and hardcoded for demonstration purposes.

Username: Austin ;)

Password: AME
