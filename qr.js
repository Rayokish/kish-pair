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

function ensureSessionFolder() {
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }
}

let activeSocket = null;
let isSendingCreds = false;

router.get('/', async (req, res) => {
  ensureSessionFolder();

  let responded = false;

  try {
    // Fully close previous socket if any
    if (activeSocket) {
      try {
        if (activeSocket?.end) await activeSocket.end();
      } catch (e) {
        console.log('Cleanup previous socket error:', e.message);
      }
      activeSocket = null;
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

      if (qr && !qrSent && !responded) {
        qrSent = true;
        try {
          const qrBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrBuffer.length,
          });
          res.end(qrBuffer);
          responded = true;
        } catch (error) {
          console.error('QR generation failed:', error);
          if (!responded && !res.headersSent) {
            res.status(500).send('Failed to generate QR');
            responded = true;
          }
          await safeClose(sock);
        }
      }

      if (connection === 'open' && !isSendingCreds) {
        isSendingCreds = true;
        try {
          await sendCredentials(sock);
        } catch (error) {
          console.error('Failed to send credentials:', error);
        } finally {
          // Delay then close socket and clear session folder to avoid conflicts
          setTimeout(async () => {
            await safeClose(sock);
            cleanupSessionFolder();
          }, 2000);
          isSendingCreds = false;
        }
      }

      if (connection === 'close') {
        console.log('Connection closed:', lastDisconnect?.error?.message || 'Unknown reason');
        activeSocket = null;
        // Optional: cleanup session on disconnect to avoid reuse conflicts
        cleanupSessionFolder();
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout for QR generation
    setTimeout(async () => {
      if (!qrSent && !responded) {
        res.status(408).send('QR generation timed out');
        responded = true;
        await safeClose(sock);
        cleanupSessionFolder();
      }
    }, 30000);

  } catch (error) {
    console.error('Initialization error:', error);
    if (!responded && !res.headersSent) {
      res.status(500).send('Internal server error');
      responded = true;
    }
    await safeClose(activeSocket);
    cleanupSessionFolder();
  }
});

// Gracefully close socket
async function safeClose(sock) {
  try {
    if (sock?.end) await sock.end();
  } catch (e) {
    console.log('Safe close error:', e.message);
  }
  activeSocket = null;
}

// Remove session folder contents to avoid reuse conflicts
function cleanupSessionFolder() {
  try {
    if (fs.existsSync(sessionFolder)) {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
  } catch (e) {
    console.log('Session folder cleanup error:', e.message);
  }
}

// Send credentials file and notification message to user
async function sendCredentials(sock) {
  const credsPath = path.join(sessionFolder, 'creds.json');

  // Wait until creds.json exists and is not empty
  await new Promise((resolve) => {
    const checkFile = () => {
      if (fs.existsSync(credsPath)) {
        const stats = fs.statSync(credsPath);
        if (stats.size > 0) return resolve();
      }
      setTimeout(checkFile, 500);
    };
    checkFile();
  });

  if (!sock || !sock.user?.id) {
    throw new Error('Connection not active');
  }

  await retrySend(sock, { text: '✅ Session connected successfully!' });

  await retrySend(sock, {
    document: fs.readFileSync(credsPath),
    fileName: `whatsapp_creds_${Date.now()}.json`,
    mimetype: 'application/json',
    caption: 'Your WhatsApp session credentials',
  });
}

// Retry sending messages with backoff
async function retrySend(sock, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sock.sendMessage(sock.user.id, message);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

module.exports = router;
