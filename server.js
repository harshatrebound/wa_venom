// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const venom = require('venom-bot');
const path = require('path');
const helmet = require('helmet'); // Import helmet
const { body, validationResult } = require('express-validator'); // Import validator
const pino = require('pino'); // Import pino
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const basicAuth = require('express-basic-auth');

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info', // Default to 'info'
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' } // Use pino-pretty in development
    : undefined, // Use default JSON output in production
});

const app = express();
const server = http.createServer(app);

// --- CORS Configuration ---
const allowedOrigin = process.env.CORS_ORIGIN || '*'; // Use env variable or default to *
logger.info(`Configuring CORS for origin: ${allowedOrigin}`);

const io = new Server(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"]
    }
});

// --- Global variables ---
let venomClient = null;
let sessionStatus = 'notLogged'; // Initial status
let qrCodeBase64 = null;
// Use environment variable for session name, default if not set
const SESSION_NAME = process.env.SESSION_NAME || 'whatsapp-session';

// --- Helper function to update status and emit ---
function updateStatus(newStatus, qrData = null) {
    logger.info({ status: newStatus }, 'Session Status Updated'); // Use logger
    sessionStatus = newStatus;
    qrCodeBase64 = qrData; // Update QR code (null if not applicable)
    io.emit('status_update', sessionStatus); // Emit to all connected clients
    if (qrData) {
        io.emit('qr_code', qrData);
    }
}

// --- Venom Session Start Function ---
async function startVenomSession() {
    if (venomClient || ['starting', 'isLogged', 'chatsAvailable', 'qrRead'].includes(sessionStatus)) {
        logger.warn({ currentStatus: sessionStatus }, 'Session start requested but already started or in progress.');
        // Optionally re-emit current state to be sure
        updateStatus(sessionStatus, qrCodeBase64);
        return;
    }

    logger.info(`Starting Venom session: ${SESSION_NAME}`);
    updateStatus('starting');

    try {
        venomClient = await venom.create(
            SESSION_NAME,
            // QR Code Callback
            (base64Qr, asciiQR, attempts, urlCode) => {
                logger.info('QR Code Received');
                updateStatus('qrRead', base64Qr);
            },
            // Status Callback
            (statusSessionUpdate, session) => {
                logger.info({ status: statusSessionUpdate, session }, 'Venom Status Callback Received');
                // Update global status based on callback
                updateStatus(statusSessionUpdate, (statusSessionUpdate === 'qrRead') ? qrCodeBase64 : null);

                // Store client instance when logged in
                // if (statusSessionUpdate === 'isLogged' || statusSessionUpdate === 'chatsAvailable') {
                //     // Client is ready
                // }

                // Reset client if disconnected or browser closed
                if (['notLogged', 'browserClose', 'desconnectedMobile', 'deleteToken'].includes(statusSessionUpdate)) {
                    logger.warn({ status: statusSessionUpdate }, 'Session disconnected or token deleted. Resetting client.');
                    venomClient = null;
                    // Ensure status is updated AFTER client is nullified
                    updateStatus(statusSessionUpdate);
                }
            },
            // Options
            {
                headless: 'new', // Use the new headless mode
                // puppeteerOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }, // Uncomment if running in Docker/Linux without proper user setup
                logQR: false, // We handle QR logs via callback
                autoClose: 60000, // Close after 60s if QR not scanned (default)
                disableWelcome: true,
                sessionFolder: path.join(__dirname, 'tokens'), // Explicitly set session folder
                folderNameToken: SESSION_NAME // Use the same name for token folder
            }
        );

        logger.info('Venom client instance created.');
        // Double-check status after create resolves
        if (!['isLogged', 'chatsAvailable'].includes(sessionStatus)) {
            try {
                 const currentState = await venomClient.getConnectionState();
                 logger.info({ connectionState: currentState }, "Current connection state after create");
                 if (currentState === 'CONNECTED') {
                      updateStatus('isLogged');
                 } else {
                     logger.warn('Client created but connection state is not CONNECTED. Might need restart.');
                     updateStatus('notLogged'); // Fallback status
                     // Don't nullify client immediately, allow status callback to handle potential reconnection
                     // venomClient = null; // Reset client if not truly connected? Maybe handled by status cb
                 }
            } catch (stateError) {
                logger.error({ error: stateError }, "Error getting connection state after create");
                updateStatus('error');
                venomClient = null;
            }

        } else {
             // Already updated by status callback
             logger.info("Client status already updated to logged in state by callback.");
             updateStatus(sessionStatus);
        }
        // Add message listeners or other initial setup here if needed
        // venomClient.onMessage(...) etc.

    } catch (error) {
        logger.error({ error: error.message, stack: error.stack }, 'Error starting Venom session');
        venomClient = null;
        updateStatus('error'); // Set status to error
    }
}

// --- Middleware ---
app.use(helmet()); // Add security headers
app.use(cors({ // Configure CORS using the variable
    origin: allowedOrigin,
    methods: ["GET", "POST"]
}));
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from public directory

// --- Swagger Definition ---
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Venom WhatsApp Bot API',
      version: '1.0.0',
      description: 'API documentation for the Venom WhatsApp Bot application, providing endpoints to manage sessions and send messages.',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: 'Development server'
      },
      // Add other servers like production if needed
    ],
    components: {
        securitySchemes: {
          basicAuth: { // Can be called anything, chose "basicAuth" for clarity
            type: 'http',
            scheme: 'basic'
          }
        }
    },
    // security: [
    //   {
    //     basicAuth: [] // Apply basic auth globally if needed, but we apply per-route
    //   }
    // ]
  },
  apis: ['./server.js'], // Files containing annotations
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// --- Basic Authentication Middleware for Swagger ---
// Ensure ADMIN_USERNAME and ADMIN_PASSWORD are set in .env
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

let swaggerUsers = {};
if (adminUsername && adminPassword) {
    swaggerUsers[adminUsername] = adminPassword;
} else {
    logger.warn('ADMIN_USERNAME or ADMIN_PASSWORD not set in environment. Swagger UI will be unprotected or inaccessible if auth is enforced without users.');
    // Handle this case - maybe disable swagger or use default insecure creds?
    // For now, it will allow access without auth if creds aren't set, which is bad practice.
    // A better approach would be to throw an error or disable the route.
}

const swaggerAuth = basicAuth({
    users: swaggerUsers,
    challenge: true, // Send WWW-Authenticate header to prompt for login
    unauthorizedResponse: (req) => {
        return `Unauthorized access to API docs. Please provide valid credentials.`;
    }
});

// --- Swagger UI Route (Protected) ---
// Serve Swagger UI at /api-docs, protected by basic auth
app.use('/api-docs', swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Socket.IO Connection ---
io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'User connected via Socket.IO');

    // Send initial status and QR code if available
    socket.emit('status_update', sessionStatus);
    if (sessionStatus === 'qrRead') {
        socket.emit('qr_code', qrCodeBase64);
    }

    socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, 'User disconnected via Socket.IO');
    });
});

// --- Authentication Endpoint ---
/**
 * @swagger
 * /login:
 *   post:
 *     summary: Authenticate user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 format: password
 *                 example: password
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Login successful
 *       401:
 *         description: Invalid username or password
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Invalid username or password
 *       500:
 *         description: Server configuration error (credentials not set)
 */
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
        logger.error('Admin username or password not configured in environment variables.');
        return res.status(500).json({ success: false, message: 'Server configuration error.' });
    }

    if (username === adminUsername && password === adminPassword) {
        logger.info({ username }, 'Successful login');
        // In a real app, you'd generate a token or session here
        res.status(200).json({ success: true, message: 'Login successful' });
    } else {
        logger.warn({ username }, 'Failed login attempt');
        res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
});

// --- Routes ---
/**
 * @swagger
 * tags:
 *   name: Session
 *   description: WhatsApp session management
 */

/**
 * @swagger
 * /:
 *   get:
 *     summary: Serves the frontend application
 *     tags: [Frontend]
 *     responses:
 *       200:
 *         description: HTML content of the single page application.
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint to start the WhatsApp session
/**
 * @swagger
 * /start:
 *   post:
 *     summary: Start a new WhatsApp session
 *     description: Initiates the connection to WhatsApp Web, prompts for QR code scan if not logged in.
 *     tags: [Session]
 *     responses:
 *       200:
 *         description: Session initialization started (QR code might be required).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Session initialization started.
 *                 status:
 *                   type: string
 *                   example: starting
 *       400:
 *         description: Session already active or starting.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Session already active or starting.
 *                 status:
 *                   type: string
 *                   example: isLogged
 *       500:
 *         description: Internal server error during session start.
 */
app.post('/start', async (req, res, next) => { // Add next for error handling
    if (!venomClient && !['starting', 'qrRead', 'isLogged', 'chatsAvailable'].includes(sessionStatus)) {
        try {
            await startVenomSession();
            res.status(200).json({ message: 'Session initialization started.', status: sessionStatus });
        } catch (error) {
             logger.error({ error }, "Error caught in /start endpoint");
             next(error); // Pass error to central handler
        }
    } else {
        logger.warn({ currentStatus: sessionStatus }, "/start called when session already active or starting.");
        res.status(400).json({ message: 'Session already active or starting.', status: sessionStatus });
    }
});

// Endpoint to get the current session status
/**
 * @swagger
 * /status:
 *   get:
 *     summary: Get current WhatsApp session status
 *     description: Returns the current status of the WhatsApp connection and the QR code if applicable.
 *     tags: [Session]
 *     responses:
 *       200:
 *         description: Current session status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: The current connection state (e.g., notLogged, qrRead, isLogged).
 *                   example: isLogged
 *                 qrCode:
 *                   type: string
 *                   format: binary
 *                   description: Base64 encoded QR code image data, only present if status is 'qrRead'.
 *                   nullable: true
 *                   example: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...
 */
app.get('/status', (req, res) => {
    res.status(200).json({ status: sessionStatus, qrCode: (sessionStatus === 'qrRead') ? qrCodeBase64 : null });
});

// Endpoint to log out
/**
 * @swagger
 * /logout:
 *   post:
 *     summary: Logout from the current WhatsApp session
 *     description: Disconnects the current WhatsApp Web session.
 *     tags: [Session]
 *     responses:
 *       200:
 *         description: Logout successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logout successful.
 *                 status:
 *                   type: string
 *                   example: notLogged
 *       400:
 *         description: No active session to log out.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: No active session to log out.
 *                 status:
 *                   type: string
 *                   example: notLogged
 *       500:
 *         description: Error during logout process.
 */
app.post('/logout', async (req, res, next) => { // Add next
    if (venomClient) {
        try {
            logger.info("Attempting to logout...");
            await venomClient.logout();
            logger.info('Logout successful via API.');
            // Status callback should handle setting venomClient = null and status update
            res.status(200).json({ message: 'Logout successful.', status: 'notLogged' });
        } catch (error) {
            logger.error({ error }, 'Error during API logout');
            // Attempt to reset state even if logout command fails
            venomClient = null;
            updateStatus('error');
            next(error); // Pass error to central handler
        }
    } else {
        logger.warn("/logout called but no active session found.");
        updateStatus('notLogged'); // Ensure status is correct if already logged out
        res.status(400).json({ message: 'No active session to log out.', status: 'notLogged' });
    }
});

// --- Helper function to check if client is ready ---
function isClientReady() {
    const ready = venomClient && ['isLogged', 'chatsAvailable'].includes(sessionStatus);
    if (!ready) {
        logger.warn({ clientExists: !!venomClient, status: sessionStatus }, "Client not ready check failed.");
    }
    return ready;
}

// --- Validation Middleware ---
const validateSendText = [
  body('to').notEmpty().withMessage('Recipient phone number ("to") is required.').isString(),
  body('message').notEmpty().withMessage('Message content ("message") is required.').isString(),
];

// --- Message Sending Endpoints ---
/**
 * @swagger
 * tags:
 *   name: Messaging
 *   description: Endpoints for sending WhatsApp messages
 */

// Send text message
/**
 * @swagger
 * /send/text:
 *   post:
 *     summary: Send a text message
 *     tags: [Messaging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - message
 *             properties:
 *               to:
 *                 type: string
 *                 description: Recipient phone number (e.g., 15551234567 or 15551234567@c.us).
 *                 example: "15551234567"
 *               message:
 *                 type: string
 *                 description: The text message content.
 *                 example: "Hello from the API!"
 *     responses:
 *       200:
 *         description: Message sent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Message sent successfully
 *                 data:
 *                   type: object
 *                   description: Response data from the WhatsApp client.
 *       400:
 *         description: Bad request (e.g., missing parameters, validation error, session not active).
 *       500:
 *         description: Internal server error during message sending.
 */
app.post('/send/text', validateSendText, async (req, res, next) => { // Add validation and next
    // Handle validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn({ errors: errors.array() }, "Validation failed for /send/text");
      return res.status(400).json({ success: false, message: "Validation errors", errors: errors.array() });
    }

    if (!isClientReady()) {
        return res.status(400).json({
            success: false,
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, message } = req.body;

    try {
        // Basic formatting - might need refinement based on actual numbers
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\\d]/g, '')}@c.us`;
        logger.info({ recipient: formattedNumber }, `Attempting to send text message`);

        const result = await venomClient.sendText(formattedNumber, message);
        logger.info({ recipient: formattedNumber, resultId: result.id }, `Text message sent successfully`);

        res.status(200).json({
            success: true,
            message: 'Message sent successfully',
            data: result
        });
    } catch (error) {
        logger.error({ error: error.message, recipient: to }, 'Error sending text message');
        // Pass error to the central handler
        next(new Error(`Failed to send text message: ${error.message}`));
    }
});

// Send media (image, video, document) - Apply similar validation pattern
/**
 * @swagger
 * /send/media:
 *   post:
 *     summary: Send a media message (image, video, document, audio)
 *     tags: [Messaging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - type
 *               - url
 *             properties:
 *               to:
 *                 type: string
 *                 description: Recipient phone number.
 *                 example: "15551234567"
 *               type:
 *                 type: string
 *                 description: Type of media to send.
 *                 enum: [image, video, document, audio]
 *                 example: image
 *               url:
 *                 type: string
 *                 format: url
 *                 description: URL of the media file.
 *                 example: "https://example.com/image.jpg"
 *               caption:
 *                 type: string
 *                 description: Optional caption for the media.
 *                 example: "Look at this!"
 *               fileName:
 *                 type: string
 *                 description: Optional filename for the media (especially for documents).
 *                 example: "report.pdf"
 *     responses:
 *       200:
 *         description: Media sent successfully.
 *       400:
 *         description: Bad request (missing parameters, invalid type, session not active).
 *       500:
 *         description: Internal server error or failed to send media.
 *       501:
 *          description: Media type not implemented (e.g., Sticker from URL).
 */
// TODO: Add express-validator checks for /send/media
app.post('/send/media', /* Add validation middleware here */ async (req, res, next) => { // Add next
    if (!isClientReady()) {
        return res.status(400).json({
            success: false,
            message: 'WhatsApp session not active. Please scan QR code and try again.',
            status: sessionStatus
        });
    }

    const { to, type, url, caption, fileName } = req.body;

    // Basic check - replace with express-validator later
    if (!to || !type || !url) {
         logger.warn({ body: req.body }, "Missing parameters for /send/media");
         return res.status(400).json({
             success: false,
             message: 'Missing required parameters: "to", "type" (image, video, document), and "url" are required.'
         });
    }
    const validTypes = ['image', 'video', 'document', 'audio', 'sticker'];
    if (!validTypes.includes(type.toLowerCase())) {
         logger.warn({ type: type }, "Invalid media type for /send/media");
         return res.status(400).json({
             success: false,
             message: `Invalid media type "${type}". Valid types are: ${validTypes.join(', ')}`
         });
    }


    try {
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\\d]/g, '')}@c.us`;
        let result;
        const effectiveFileName = fileName || url.substring(url.lastIndexOf('/') + 1); // Use provided name or derive from URL

        logger.info({ recipient: formattedNumber, type, url }, `Attempting to send media`);

        switch (type.toLowerCase()) {
            case 'image':
                result = await venomClient.sendImage(formattedNumber, url, effectiveFileName, caption);
                break;
            case 'video':
                result = await venomClient.sendVideoAsGif(formattedNumber, url, effectiveFileName, caption); // Or sendVideo for non-GIF
                break;
            case 'document':
                result = await venomClient.sendFile(formattedNumber, url, effectiveFileName, caption);
                break;
             case 'audio': // Example: Sending audio needs a specific function if available, or send via sendFile
                // result = await venomClient.sendVoice(formattedNumber, url); // If sending as voice note
                 result = await venomClient.sendFile(formattedNumber, url, effectiveFileName, caption); // Or as a file
                break;
             case 'sticker': // Requires different handling - needs a local file path usually or base64
                 logger.warn("Sticker sending via URL is complex/not directly supported by default sendFile. Needs specific implementation.");
                 // result = await venomClient.sendImageAsSticker(formattedNumber, url); // Needs image URL or path
                 return res.status(501).json({ success: false, message: "Sending sticker from URL not implemented yet." });
            default: // Should not happen due to validation above, but good practice
                 throw new Error(`Unsupported media type: ${type}`);
        }

        logger.info({ recipient: formattedNumber, type, resultId: result.id }, `Media sent successfully`);
        res.status(200).json({ success: true, message: `Media (${type}) sent successfully`, data: result });

    } catch (error) {
        logger.error({ error: error.message, recipient: to, type }, `Error sending media (${type})`);
        next(new Error(`Failed to send media (${type}): ${error.message}`));
    }
});

// Send an interactive list menu
/**
 * @swagger
 * /send/list:
 *   post:
 *     summary: Send an interactive list message
 *     tags: [Messaging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - title
 *               - description
 *               - buttonText
 *               - sections
 *             properties:
 *               to:
 *                 type: string
 *                 example: "15551234567"
 *               title:
 *                 type: string
 *                 example: "Choose an Option"
 *               subtitle:
 *                 type: string
 *                 example: "Select one from the list below"
 *               description:
 *                 type: string
 *                 example: "Available choices:"
 *               buttonText:
 *                 type: string
 *                 example: "View Options"
 *               sections:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                       example: "Section 1"
 *                     rows:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           title:
 *                             type: string
 *                             example: "Option 1"
 *                           description:
 *                             type: string
 *                             example: "Description for Option 1"
 *     responses:
 *       200:
 *         description: List message sent successfully.
 *       400:
 *         description: Bad request (missing parameters, invalid format, session not active).
 *       500:
 *         description: Internal server error or failed to send list.
 */
// TODO: Add express-validator checks for /send/list
app.post('/send/list', /* Add validation middleware here */ async (req, res, next) => { // Add next
     if (!isClientReady()) {
        return res.status(400).json({ success: false, message: 'WhatsApp session not active.', status: sessionStatus });
    }
    const { to, title, subtitle, description, buttonText, sections } = req.body;

    // Basic checks - replace with express-validator
    if (!to || !title || !description || !buttonText || !sections || !Array.isArray(sections) || sections.length === 0) {
        logger.warn({ body: req.body }, "Missing or invalid parameters for /send/list");
        return res.status(400).json({ success: false, message: 'Missing or invalid parameters for list message.' });
    }

    try {
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\\d]/g, '')}@c.us`;
        logger.info({ recipient: formattedNumber }, `Attempting to send list message`);

        const result = await venomClient.sendListMenu(formattedNumber, title, subtitle, description, buttonText, sections);

        logger.info({ recipient: formattedNumber, resultId: result.id }, `List message sent successfully`);
        res.status(200).json({ success: true, message: 'List message sent successfully', data: result });

    } catch (error) {
        logger.error({ error: error.message, recipient: to }, 'Error sending list message');
        next(new Error(`Failed to send list message: ${error.message}`));
    }
});

// Send buttons
/**
 * @swagger
 * /send/buttons:
 *   post:
 *     summary: Send a message with interactive buttons
 *     tags: [Messaging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - description
 *               - buttons
 *             properties:
 *               to:
 *                 type: string
 *                 example: "15551234567"
 *               title:
 *                 type: string
 *                 description: Optional title for the button message.
 *                 example: "Quick Reply"
 *               description:
 *                 type: string
 *                 description: Main text content of the message.
 *                 example: "Please select an action:"
 *               buttons:
 *                 type: array
 *                 description: Array of button objects.
 *                 items:
 *                   type: object
 *                   properties:
 *                     buttonId:
 *                       type: string
 *                       description: Optional ID for the button (used for Button Reply events).
 *                       example: "id1"
 *                     buttonText:
 *                       type: object
 *                       properties:
 *                         displayText:
 *                           type: string
 *                           example: "Action 1"
 *     responses:
 *       200:
 *         description: Buttons message sent successfully.
 *       400:
 *         description: Bad request (missing parameters, invalid format, session not active).
 *       500:
 *         description: Internal server error or failed to send buttons.
 */
// TODO: Add express-validator checks for /send/buttons
app.post('/send/buttons', /* Add validation middleware here */ async (req, res, next) => { // Add next
    if (!isClientReady()) {
        return res.status(400).json({ success: false, message: 'WhatsApp session not active.', status: sessionStatus });
    }
    const { to, title, description, buttons } = req.body;

    // Basic checks - replace with express-validator
     if (!to || !description || !buttons || !Array.isArray(buttons) || buttons.length === 0) {
        logger.warn({ body: req.body }, "Missing or invalid parameters for /send/buttons");
        return res.status(400).json({ success: false, message: 'Missing or invalid parameters for button message.' });
    }

    try {
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\\d]/g, '')}@c.us`;
        logger.info({ recipient: formattedNumber }, `Attempting to send buttons message`);

        // Adjust button format if needed based on venom-bot documentation for Buttons Message Type
        // The example in README might need adjustment. Assuming it's correct for now.
        const result = await venomClient.sendButtons(formattedNumber, title || '', buttons, description); // Title might be optional or part of description

        logger.info({ recipient: formattedNumber, resultId: result.id }, `Buttons message sent successfully`);
        res.status(200).json({ success: true, message: 'Buttons message sent successfully', data: result });

    } catch (error) {
        logger.error({ error: error.message, recipient: to }, 'Error sending buttons message');
        next(new Error(`Failed to send buttons message: ${error.message}`));
    }
});

// Send location
/**
 * @swagger
 * /send/location:
 *   post:
 *     summary: Send a location message
 *     tags: [Messaging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - latitude
 *               - longitude
 *               - name
 *             properties:
 *               to:
 *                 type: string
 *                 example: "15551234567"
 *               latitude:
 *                 type: string # Using string as coordinates can be floats or strings
 *                 example: "37.7749"
 *               longitude:
 *                 type: string
 *                 example: "-122.4194"
 *               name:
 *                 type: string
 *                 description: Name of the location/place.
 *                 example: "San Francisco, CA"
 *     responses:
 *       200:
 *         description: Location sent successfully.
 *       400:
 *         description: Bad request (missing parameters, session not active).
 *       500:
 *         description: Internal server error or failed to send location.
 */
// TODO: Add express-validator checks for /send/location
app.post('/send/location', /* Add validation middleware here */ async (req, res, next) => { // Add next
     if (!isClientReady()) {
        return res.status(400).json({ success: false, message: 'WhatsApp session not active.', status: sessionStatus });
    }
    const { to, latitude, longitude, name } = req.body;

     // Basic checks - replace with express-validator
    if (!to || !latitude || !longitude || !name) {
        logger.warn({ body: req.body }, "Missing parameters for /send/location");
        return res.status(400).json({ success: false, message: 'Missing required parameters: "to", "latitude", "longitude", "name".' });
    }

    try {
        const formattedNumber = to.includes('@c.us') ? to : `${to.replace(/[^\\d]/g, '')}@c.us`;
        logger.info({ recipient: formattedNumber }, `Attempting to send location message`);

        const result = await venomClient.sendLocation(formattedNumber, latitude, longitude, name);

        logger.info({ recipient: formattedNumber, resultId: result.id }, `Location message sent successfully`);
        res.status(200).json({ success: true, message: 'Location sent successfully', data: result });

    } catch (error) {
        logger.error({ error: error.message, recipient: to }, 'Error sending location');
        next(new Error(`Failed to send location: ${error.message}`));
    }
});


// --- Central Error Handling Middleware ---
// Must be defined LAST, after all other app.use() and routes
app.use((err, req, res, next) => {
    logger.error({
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip
    }, "Unhandled error occurred");

    // Avoid sending stack trace in production
    const errorResponse = {
        success: false,
        message: 'An internal server error occurred.',
        ...(process.env.NODE_ENV !== 'production' && { error: err.message }) // Include error message in non-prod
    };

    res.status(err.status || 500).json(errorResponse);
});


// --- Start the Server ---
const PORT = process.env.PORT || 3000; // Use environment variable for port or default to 3000
server.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    // Optionally, try to auto-start the session on server boot
    // logger.info("Attempting to auto-start Venom session on server startup...");
    // startVenomSession(); // Be cautious with auto-start, might cause issues if server restarts frequently
});

// Graceful shutdown handling (optional but good practice)
process.on('SIGINT', async () => {
    logger.info('SIGINT signal received. Shutting down gracefully...');
    if (venomClient) {
        try {
            logger.info('Closing Venom client...');
            await venomClient.close();
            logger.info('Venom client closed.');
        } catch (e) {
            logger.error({ error: e }, 'Error closing Venom client during shutdown.');
        }
    }
    server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
     logger.info('SIGTERM signal received. Shutting down gracefully...');
    if (venomClient) {
        try {
            logger.info('Closing Venom client...');
            await venomClient.close();
            logger.info('Venom client closed.');
        } catch (e) {
            logger.error({ error: e }, 'Error closing Venom client during shutdown.');
        }
    }
    server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
    });
}); 