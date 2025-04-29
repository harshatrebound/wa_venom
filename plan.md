Okay, I can help with that. First, I'll research the `venom-bot` library to understand its features and how it handles QR code login, sending different message types (text, media, lists), and session management. Then, I'll outline a plan to build the application with a Node.js backend API and a simple frontend.

**Researching `venom-bot`:**

I'll start by searching the web for information about `venom-bot`'s capabilities.

Ran tool
Based on the research, particularly the official GitHub repository (`orkestral/venom`):

**`venom-bot` Capabilities:**

* **Session Management:**
  * Starts a WhatsApp Web session using `venom.create()`.
  * Handles QR code generation automatically, providing callbacks for `base64Qrimg` (image data) and `asciiQR` (terminal display).
  * Remembers sessions using a `session` name, avoiding repeated QR scans.
  * Provides detailed session status updates via a callback (`statusSession`), indicating states like `isLogged`, `notLogged`, `qrReadSuccess`, `qrReadFail`, `browserClose`, `desconnectedMobile`, etc.
  * Supports multiple simultaneous sessions.
  * Has a `client.logout()` function to disconnect the session.
  * Has functions to check connection state (`client.getConnectionState()`, `client.isConnected()`).
  * Includes mechanisms to keep the session alive (e.g., `client.useHere()` on `CONFLICT`).
* **Sending Messages:**
  * **Text:** `client.sendText(chatId, message)`
  * **Media:**
    * Images: `client.sendImage(chatId, path/url, imageName, caption)`, `client.sendImageFromBase64(...)`
    * Video: `client.sendVideoAsGif(...)`, `client.sendFile(...)` (handles videos too)
    * Audio: `client.sendVoice(chatId, path)`, `client.sendVoiceBase64(...)`
    * Documents: `client.sendFile(chatId, path, fileName, caption)`, `client.sendFileFromBase64(...)`
  * **Interactive:**
    * Lists: `client.sendListMenu(chatId, title, subTitle, description, buttonText, list)`
    * Buttons: `client.sendButtons(chatId, title, description, buttons)`
    * Polls: `client.sendPollCreation(chatId, pollObject)`
  * **Other:**
    * Location: `client.sendLocation(chatId, lat, long, locationName)`
    * Contacts: `client.sendContactVcard(chatId, contactToSendId, contactName)`, `client.sendContactVcardList(...)`
    * Stickers: `client.sendImageAsSticker(chatId, path/base64)`, `client.sendImageAsStickerGif(...)`
    * Mentions: `client.sendMentioned(chatId, message, mentionedIds)`
    * Replies: `client.reply(chatId, message, messageIdToReply)`
    * Link Previews: `client.sendLinkPreview(chatId, url, caption)`
* **Receiving Messages:** `client.onMessage(callback)`, `client.onAnyMessage(callback)`
* **Other Features:** Getting contacts, chats, groups, group members, blocking/unblocking users, managing groups (create, leave, add/remove members, promote/demote), setting profile status/name/picture, checking number status, etc.

**Plan:**

Based on the research and your requirements, here's a plan:

1. **Project Setup:**
   * Create a new directory for the project.
   * Initialize a Node.js project: `npm init -y`
   * Install dependencies: `npm install express venom-bot cors socket.io`
   * Setup basic file structure:
     * `server.js` (or `index.js`): Main backend file.
     * `public/`: Directory for frontend files (HTML, CSS, JS).
     * `public/index.html`: Frontend HTML.
     * `public/style.css`: Frontend CSS.
     * `public/script.js`: Frontend JavaScript.
2. **Backend (`server.js`):**
   * Initialize Express app and Socket.IO server.
   * Configure CORS.
   * Store `venom-bot` client instance and session status globally (or in a dedicated module).
   * **`/login` (POST):** Endpoint to simulate login (check predefined credentials). In a real app, this would involve proper authentication. For now, it might just be a placeholder or check hardcoded values.
   * **`/start` (POST):**
     * Call `venom.create()` with a session name.
     * Use the `catchQR` callback to get the `base64Qrimg`. Emit this QR code data via Socket.IO to the connected frontend client.
     * Use the `statusFind` callback to track the session status (`isLogged`, `notLogged`, etc.). Store the status and emit updates via Socket.IO.
   * **`/status` (GET):** Return the current stored session status.
   * **`/logout` (POST):** If a client instance exists and is connected, call `client.logout()`. Update and emit the status.
   * **`/send/text` (POST):** Endpoint accepting `to` (phone number) and `message`. Call `client.sendText()`.
   * **`/send/media` (POST):** Endpoint accepting `to`, `type` (image, video, doc), `url` or `filePath`, `caption`. Call appropriate `venom-bot` functions (`sendImage`, `sendFile`, etc.). Might need `multer` for file uploads if sending local files via frontend.
   * **`/send/list` (POST):** Endpoint accepting `to`, `title`, `description`, `buttonText`, `sections` (list data). Call `client.sendListMenu()`.
   * **(Add other `/send/*` endpoints as needed)**
   * **Socket.IO:**
     * Handle frontend connections.
     * Emit `qr_code` event with base64 QR data.
     * Emit `status_update` event with the session status string.
3. **Frontend (`public/`):**
   * **`index.html`:**
     * Basic login form (username/password fields, login button).
     * Main application area (hidden initially):
       * Status display area.
       * QR code display area (e.g., `<img>` tag).
       * Logout button.
       * Forms/buttons for sending messages (text, media, list).
   * **`style.css`:** Basic styling for the elements.
   * **`script.js`:**
     * Connect to the backend Socket.IO server.
     * **Login:** Add event listener to the login button. On click, check predefined credentials (hardcoded in JS for simplicity). If valid, hide login form, show app area, maybe call `/status` initially.
     * **Socket Listeners:**
       * Listen for `qr_code`: Update the `src` of the QR code `<img>` tag.
       * Listen for `status_update`: Update the status display area. Show/hide QR code based on status.
     * **Actions:**
       * Add event listener to "Start Session" button (or trigger automatically after login): Send POST request to `/start`.
       * Add event listener to "Logout" button: Send POST request to `/logout`.
       * Add event listeners to "Send" buttons: Gather data from input fields, send POST requests to the corresponding `/send/*` endpoints.
4. **Refinements:**
   * Error handling on both frontend and backend.
   * Clearer UI feedback for sending messages (success/failure).
   * Consider security implications (hardcoded credentials are not secure for real applications).
   * Manage file paths/URLs for media sending.

This plan covers all your requirements. Do you approve this plan? We can start building step-by-step once you confirm.
