document.addEventListener('DOMContentLoaded', () => {
    // Connect to Socket.io server
    const socket = io();
    
    // UI Elements
    const loginSection = document.getElementById('login-section');
    const appSection = document.getElementById('app-section');
    const statusDisplay = document.getElementById('status-display');
    const qrContainer = document.getElementById('qr-container');
    const qrCode = document.getElementById('qr-code');
    const messageSection = document.getElementById('message-section');
    const notificationArea = document.getElementById('notification-area');
    
    // Credentials (simulated, in a real app these would come from a server)
    const VALID_USERNAME = 'admin';
    const VALID_PASSWORD = 'password';
    
    // --- Helper Functions ---
    
    // Show notification
    function showNotification(message, isError = false) {
        notificationArea.textContent = message;
        notificationArea.className = isError ? 'error' : '';
        notificationArea.classList.remove('hidden');
        
        // Hide after 5 seconds
        setTimeout(() => {
            notificationArea.classList.add('hidden');
        }, 5000);
    }
    
    // Handle session status updates
    function updateSessionStatus(status) {
        statusDisplay.textContent = status;
        
        // Show/hide UI elements based on status
        if (status === 'qrRead') {
            qrContainer.classList.remove('hidden');
            messageSection.classList.add('hidden');
        } else if (status === 'isLogged' || status === 'chatsAvailable') {
            qrContainer.classList.add('hidden');
            messageSection.classList.remove('hidden');
            showNotification('WhatsApp connected successfully!');
        } else {
            qrContainer.classList.add('hidden');
            messageSection.classList.add('hidden');
        }
        
        // Additional state-specific handling
        if (status === 'notLogged' || status === 'browserClose' || status === 'desconnectedMobile' || status === 'deleteToken') {
            showNotification('WhatsApp session ended or not connected.');
        } else if (status === 'error') {
            showNotification('An error occurred with the WhatsApp session.', true);
        }
    }
    
    // Format API response (success or error)
    function handleApiResponse(response, successMessage) {
        if (response.ok) {
            return response.json().then(data => {
                showNotification(successMessage);
                return data;
            });
        } else {
            return response.json().then(error => {
                showNotification(`Error: ${error.message || 'Unknown error'}`, true);
                throw new Error(error.message || 'Unknown error');
            });
        }
    }
    
    // --- Event Listeners ---
    
    // Login Form
    document.getElementById('login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        // Simple client-side validation
        if (username === VALID_USERNAME && password === VALID_PASSWORD) {
            loginSection.classList.add('hidden');
            appSection.classList.remove('hidden');
            
            // Fetch current session status
            fetch('/status')
                .then(response => response.json())
                .then(data => {
                    updateSessionStatus(data.status);
                    if (data.qrCode) {
                        qrCode.src = data.qrCode;
                        qrContainer.classList.remove('hidden');
                    }
                })
                .catch(error => {
                    console.error('Error fetching status:', error);
                    showNotification('Error fetching WhatsApp status.', true);
                });
        } else {
            showNotification('Invalid username or password. Try admin/password.', true);
        }
    });
    
    // Start Session
    document.getElementById('start-session').addEventListener('click', () => {
        fetch('/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => handleApiResponse(response, 'WhatsApp session starting...'))
        .catch(error => {
            console.error('Error starting session:', error);
        });
    });
    
    // Logout
    document.getElementById('logout').addEventListener('click', () => {
        fetch('/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => handleApiResponse(response, 'Logged out successfully'))
        .then(() => {
            updateSessionStatus('notLogged');
        })
        .catch(error => {
            console.error('Error logging out:', error);
        });
    });
    
    // Text Message Form
    document.getElementById('text-message-form').addEventListener('submit', (event) => {
        event.preventDefault();
        
        const to = document.getElementById('text-to').value;
        const message = document.getElementById('text-message').value;
        
        fetch('/send/text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ to, message })
        })
        .then(response => handleApiResponse(response, 'Text message sent successfully!'))
        .then(() => {
            // Clear the message input but keep the phone number
            document.getElementById('text-message').value = '';
        })
        .catch(error => {
            console.error('Error sending text message:', error);
        });
    });
    
    // Media Message Form
    document.getElementById('media-message-form').addEventListener('submit', (event) => {
        event.preventDefault();
        
        const to = document.getElementById('media-to').value;
        const type = document.getElementById('media-type').value;
        const url = document.getElementById('media-url').value;
        const caption = document.getElementById('media-caption').value;
        const fileName = document.getElementById('media-filename').value;
        
        fetch('/send/media', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ to, type, url, caption, fileName })
        })
        .then(response => handleApiResponse(response, `${type.charAt(0).toUpperCase() + type.slice(1)} sent successfully!`))
        .then(() => {
            // Clear some fields but keep the phone number and type
            document.getElementById('media-url').value = '';
            document.getElementById('media-caption').value = '';
            document.getElementById('media-filename').value = '';
        })
        .catch(error => {
            console.error('Error sending media:', error);
        });
    });
    
    // List Message Form
    document.getElementById('list-message-form').addEventListener('submit', (event) => {
        event.preventDefault();
        
        const to = document.getElementById('list-to').value;
        const title = document.getElementById('list-title').value;
        const subtitle = document.getElementById('list-subtitle').value;
        const description = document.getElementById('list-description').value;
        const buttonText = document.getElementById('list-button-text').value;
        
        let sections;
        try {
            sections = JSON.parse(document.getElementById('list-sections').value);
        } catch (error) {
            showNotification('Invalid JSON format for sections.', true);
            return;
        }
        
        fetch('/send/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ to, title, subtitle, description, buttonText, sections })
        })
        .then(response => handleApiResponse(response, 'List menu sent successfully!'))
        .catch(error => {
            console.error('Error sending list menu:', error);
        });
    });
    
    // Button Message Form
    document.getElementById('button-message-form').addEventListener('submit', (event) => {
        event.preventDefault();
        
        const to = document.getElementById('button-to').value;
        const title = document.getElementById('button-title').value;
        const description = document.getElementById('button-description').value;
        
        let buttons;
        try {
            buttons = JSON.parse(document.getElementById('button-data').value);
        } catch (error) {
            showNotification('Invalid JSON format for buttons.', true);
            return;
        }
        
        fetch('/send/buttons', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ to, title, description, buttons })
        })
        .then(response => handleApiResponse(response, 'Buttons sent successfully!'))
        .catch(error => {
            console.error('Error sending buttons:', error);
        });
    });
    
    // Location Message Form
    document.getElementById('location-message-form').addEventListener('submit', (event) => {
        event.preventDefault();
        
        const to = document.getElementById('location-to').value;
        const latitude = document.getElementById('location-latitude').value;
        const longitude = document.getElementById('location-longitude').value;
        const name = document.getElementById('location-name').value;
        
        fetch('/send/location', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ to, latitude, longitude, name })
        })
        .then(response => handleApiResponse(response, 'Location sent successfully!'))
        .catch(error => {
            console.error('Error sending location:', error);
        });
    });
    
    // --- Socket Event Listeners ---
    
    // Status update
    socket.on('status_update', (status) => {
        console.log('Status update:', status);
        updateSessionStatus(status);
    });
    
    // QR code update
    socket.on('qr_code', (qrData) => {
        console.log('QR code received');
        qrCode.src = qrData;
        qrContainer.classList.remove('hidden');
    });
    
    // Socket connection events
    socket.on('connect', () => {
        console.log('Connected to socket server');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from socket server');
    });
}); 