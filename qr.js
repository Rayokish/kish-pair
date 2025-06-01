const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { toBuffer } = require('qrcode');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');

const sessionFolder = path.join(process.cwd(), 'SESSION');

// Ensure session directory exists
function ensureSessionFolder() {
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }
}

// Connection state management
let activeSocket = null;
let isSendingCreds = false;

router.get('/', async (req, res) => {
  ensureSessionFolder();

  try {
    // Clean up previous connection if exists
    if (activeSocket) {
      try {
        activeSocket.ws.close();
      } catch (e) {
        console.log('Cleanup of previous connection:', e.message);
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    activeSocket = sock;
    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      // Handle QR Generation
      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrBuffer.length
          });
          res.end(qrBuffer);
        } catch (error) {
          console.error('QR generation failed:', error);
          if (!res.headersSent) {
            res.status(500).send('Failed to generate QR');
          }
          safeClose(sock);
        }
      }

      // Handle Successful Connection
      if (connection === 'open' && !isSendingCreds) {
        isSendingCreds = true;
        
        try {
          await sendCredentials(sock);
        } catch (error) {
          console.error('Failed to send credentials:', error);
        } finally {
          setTimeout(() => safeClose(sock), 2000);
          isSendingCreds = false;
        }
      }

      // Handle Disconnection
      if (connection === 'close') {
        console.log('Connection closed:', lastDisconnect?.error?.message);
        activeSocket = null;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout handling
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR generation timed out');
        safeClose(sock);
      }
    }, 30000);

  } catch (error) {
    console.error('Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal server error');
    }
    safeClose(activeSocket);
  }
});

// Helper function to safely close socket
function safeClose(sock) {
  try {
    if (sock && sock.ws && sock.ws.readyState !== sock.ws.CLOSED) {
      sock.ws.close();
    }
  } catch (e) {
    console.log('Safe close error:', e.message);
  }
  activeSocket = null;
}

// Helper function to send credentials
async function sendCredentials(sock) {
  const credsPath = path.join(sessionFolder, 'creds.json');
  
  // Wait for file to be created
  await new Promise(resolve => {
    const checkFile = () => {
      if (fs.existsSync(credsPath)) {
        const stats = fs.statSync(credsPath);
        if (stats.size > 0) return resolve();
      }
      setTimeout(checkFile, 500);
    };
    checkFile();
  });

  // Verify connection is still active
  if (!sock || !sock.user?.id) {
    throw new Error('Connection not active');
  }

  // Send messages with retry logic
  await retrySend(sock, {
    text: '✅ Session connected successfully!'
  });

  await retrySend(sock, {
    document: fs.readFileSync(credsPath),
    fileName: `whatsapp_creds_${Date.now()}.json`,
    mimetype: 'application/json',
    caption: 'Your WhatsApp session credentials'
  });
}

// Helper function with retry logic
async function retrySend(sock, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sock.sendMessage(sock.user.id, message);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

module.exports = router;
