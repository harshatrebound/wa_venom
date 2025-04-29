const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const venom = require('venom-bot');
const path = require('path'); // Import path module

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, adjust for production
        methods: ["GET", "POST"]
    }
});

// --- Global variables ---
let venomClient = null;
let sessionStatus = 'notLogged'; // Initial status
let qrCodeBase64 = null;
const SESSION_NAME = 'whatsapp-session'; // Define a session name

// --- Helper function to update status and emit ---
function updateStatus(newStatus, qrData = null) {
    console.log('Session Status Updated:', newStatus);
    sessionStatus = newStatus;
    qrCodeBase64 = qrData; // Update QR code (null if not applicable)
    io.emit('status_update', sessionStatus); // Emit to all connected clients
    if (qrData) {
        io.emit('qr_code', qrData);
    }
}

// --- Venom Session Start Function ---
async function startVenomSession() {
    if (venomClient || sessionStatus === 'starting' || sessionStatus === 'isLogged' || sessionStatus === 'chatsAvailable' || sessionStatus === 'qrRead') {
        console.log('Session already started or in progress.');
        // Optionally re-emit current state to be sure
        updateStatus(sessionStatus, qrCodeBase64);
        return;
    }

    console.log('Starting Venom session...');
    updateStatus('starting');

    try {
        venomClient = await venom.create(
            SESSION_NAME,
            // QR Code Callback
            (base64Qr, asciiQR, attempts, urlCode) => {
                console.log('QR Code Received');
                updateStatus('qrRead', base64Qr);
            },
            // Status Callback
            (statusSession, session) => {
                console.log('Status Callback:', statusSession, '- Session:', session);
                // Update global status based on callback
                updateStatus(statusSession, (statusSession === 'qrRead') ? qrCodeBase64 : null);

                // Store client instance when logged in
                if (statusSession === 'isLogged' || statusSession === 'chatsAvailable') {
                    // Client might be ready here, but let's rely on the .then() for the definitive client instance
                }

                // Reset client if disconnected or browser closed
                if (['notLogged', 'browserClose', 'desconnectedMobile', 'deleteToken'].includes(statusSession)) {
                    venomClient = null;
                    updateStatus(statusSession); // Ensure status is updated
                }
            },
            // Options
            {
                headless: 'new', // Use the new headless mode
                logQR: false, // We handle QR logs via callback
                autoClose: 60000, // Close after 60s if QR not scanned (default)
                disableWelcome: true,
            }
        );

        console.log('Venom client created successfully.');
        // Although status callback handles isLogged/chatsAvailable, storing client here is safer
        // Double-check status after create resolves
        if (sessionStatus !== 'isLogged' && sessionStatus !== 'chatsAvailable') {
            // If create resolves but status isn't logged in, update it
            const currentState = await venomClient.getConnectionState();
            console.log("Current connection state after create:", currentState);
            if (currentState === 'CONNECTED') {
                 updateStatus('isLogged');
            } else {
                // Handle cases where it might resolve but still not be fully logged in
                // This might indicate an issue or a state not covered by simple status strings
                console.warn('Client created but connection state is not CONNECTED.');
                 // Re-trigger start might be needed or investigate the state
                 updateStatus('notLogged'); // Fallback status
                 venomClient = null; // Reset client if not truly connected
            }
        } else {
             // Already updated by status callback
             updateStatus(sessionStatus);
        }
        // Add message listeners or other initial setup here if needed
        // client.onMessage(...) etc.

    } catch (error) {
        console.error('Error starting Venom session:', error);
        venomClient = null;
        updateStatus('error'); // Set status to error
    }
}

// --- Middleware ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from public directory

// --- Socket.IO Connection ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send initial status and QR code if available
    socket.emit('status_update', sessionStatus);
    if (sessionStatus === 'qrRead') {
        socket.emit('qr_code', qrCodeBase64);
    }

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// --- Routes ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint to start the WhatsApp session
app.post('/start', async (req, res) => {
    if (!venomClient && !['starting', 'qrRead', 'isLogged', 'chatsAvailable'].includes(sessionStatus)) {
        await startVenomSession();
        res.status(200).json({ message: 'Session initialization started.', status: sessionStatus });
    } else {
        res.status(400).json({ message: 'Session already active or starting.', status: sessionStatus });
    }
});

// Endpoint to get the current session status
app.get('/status', (req, res) => {
    res.status(200).json({ status: sessionStatus, qrCode: (sessionStatus === 'qrRead') ? qrCodeBase64 : null });
});

// Endpoint to log out
app.post('/logout', async (req, res) => {
    if (venomClient) {
        try {
            await venomClient.logout();
            console.log('Logout successful.');
            venomClient = null;
            updateStatus('notLogged');
            res.status(200).json({ message: 'Logout successful.', status: 'notLogged' });
        } catch (error) {
            console.error('Error during logout:', error);
            // Even if logout fails, try to reset state
            venomClient = null;
            updateStatus('error');
            res.status(500).json({ message: 'Error during logout.', status: 'error' });
        }
    } else {
        updateStatus('notLogged'); // Ensure status is correct if already logged out
        res.status(400).json({ message: 'No active session to log out.', status: 'notLogged' });
    }
});

// Placeholder for venom functions (will be added later)
// Send message endpoints will go here

// --- Helper function to check if client is ready ---
function isClientReady() {
    return venomClient && (sessionStatus === 'isLogged' || sessionStatus === 'chatsAvailable');
}

// --- Message Sending Endpoints ---

// Send text message
app.post('/send/text', async (req, res) => {
    if (!isClientReady()) {
        return res.status(400).json({ 
            success: false, 
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, message } = req.body;
    
    if (!to || !message) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters: "to" (phone number) and "message" are required.'
        });
    }

    try {
        // Format the phone number - ensure it has country code and correct format
        // This is a simple formatter - adjust as needed for your use case
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\d]/g, '')}@c.us`;
        
        const result = await venomClient.sendText(formattedNumber, message);
        console.log(`Text message sent to ${formattedNumber}`);
        
        res.status(200).json({ 
            success: true, 
            message: 'Message sent successfully',
            data: result 
        });
    } catch (error) {
        console.error('Error sending text message:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send message',
            error: error.message 
        });
    }
});

// Send media (image, video, document)
app.post('/send/media', async (req, res) => {
    if (!isClientReady()) {
        return res.status(400).json({ 
            success: false, 
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, type, url, caption, fileName } = req.body;
    
    if (!to || !type || !url) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters: "to", "type" (image, video, document), and "url" are required.'
        });
    }

    try {
        // Format the phone number
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\d]/g, '')}@c.us`;
        let result;

        switch (type.toLowerCase()) {
            case 'image':
                result = await venomClient.sendImage(
                    formattedNumber,
                    url,
                    fileName || 'image',
                    caption || ''
                );
                console.log(`Image sent to ${formattedNumber}`);
                break;
            
            case 'video':
                result = await venomClient.sendFile(
                    formattedNumber,
                    url,
                    fileName || 'video',
                    caption || ''
                );
                console.log(`Video sent to ${formattedNumber}`);
                break;
            
            case 'document':
                result = await venomClient.sendFile(
                    formattedNumber,
                    url,
                    fileName || 'document',
                    caption || ''
                );
                console.log(`Document sent to ${formattedNumber}`);
                break;
            
            default:
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid media type: ${type}. Supported types are: image, video, document.`
                });
        }
        
        res.status(200).json({ 
            success: true, 
            message: `${type} sent successfully`,
            data: result 
        });
    } catch (error) {
        console.error(`Error sending ${req.body.type}:`, error);
        res.status(500).json({ 
            success: false, 
            message: `Failed to send ${req.body.type}`,
            error: error.message 
        });
    }
});

// Send interactive list menu
app.post('/send/list', async (req, res) => {
    if (!isClientReady()) {
        return res.status(400).json({ 
            success: false, 
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, title, subtitle, description, buttonText, sections } = req.body;
    
    if (!to || !title || !buttonText || !sections || !Array.isArray(sections)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters. "to", "title", "buttonText", and "sections" array are required.'
        });
    }

    try {
        // Format the phone number
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\d]/g, '')}@c.us`;
        
        const result = await venomClient.sendListMenu(
            formattedNumber,
            title,
            subtitle || '',
            description || '',
            buttonText,
            sections
        );
        
        console.log(`List menu sent to ${formattedNumber}`);
        res.status(200).json({ 
            success: true, 
            message: 'List menu sent successfully',
            data: result 
        });
    } catch (error) {
        console.error('Error sending list menu:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send list menu',
            error: error.message 
        });
    }
});

// Send buttons
app.post('/send/buttons', async (req, res) => {
    if (!isClientReady()) {
        return res.status(400).json({ 
            success: false, 
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, title, description, buttons } = req.body;
    
    if (!to || !title || !buttons || !Array.isArray(buttons)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters. "to", "title", and "buttons" array are required.'
        });
    }

    try {
        // Format the phone number
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\d]/g, '')}@c.us`;
        
        const result = await venomClient.sendButtons(
            formattedNumber,
            title,
            description || '',
            buttons
        );
        
        console.log(`Buttons sent to ${formattedNumber}`);
        res.status(200).json({ 
            success: true, 
            message: 'Buttons sent successfully',
            data: result 
        });
    } catch (error) {
        console.error('Error sending buttons:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send buttons',
            error: error.message 
        });
    }
});

// Send location
app.post('/send/location', async (req, res) => {
    if (!isClientReady()) {
        return res.status(400).json({ 
            success: false, 
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, latitude, longitude, name } = req.body;
    
    if (!to || !latitude || !longitude) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters. "to", "latitude", and "longitude" are required.'
        });
    }

    try {
        // Format the phone number
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\d]/g, '')}@c.us`;
        
        const result = await venomClient.sendLocation(
            formattedNumber,
            latitude,
            longitude,
            name || 'Location'
        );
        
        console.log(`Location sent to ${formattedNumber}`);
        res.status(200).json({ 
            success: true, 
            message: 'Location sent successfully',
            data: result 
        });
    } catch (error) {
        console.error('Error sending location:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send location',
            error: error.message 
        });
    }
});

// --- Other Potential Endpoints ---
// - GET /contacts - Get all contacts
// app.get('/contacts', ...)
// - GET /chats - Get all chats
// app.get('/chats', ...)
// - More endpoints can be added as needed

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
}); 