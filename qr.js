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

const sessionFolder = path.join(__dirname, 'SESSION');

// Clear previous session on startup
function clearSession() {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
  }
}
clearSession();

let activeConnection = null;
let currentQR = null;

router.get('/', async (req, res) => {
  try {
    // Clear any existing connection
    if (activeConnection) {
      activeConnection.ws.close();
      activeConnection = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    activeConnection = sock;
    let qrSent = false;
    let credsSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      // Handle QR Generation
      if (qr && !qrSent) {
        qrSent = true;
        currentQR = qr;
        try {
          const qrBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrBuffer.length
          });
          res.end(qrBuffer);
        } catch (error) {
          console.error('QR generation failed:', error);
          res.status(500).send('Failed to generate QR');
          sock.ws.close();
        }
      }

      // Handle Successful Connection
      if (connection === 'open' && !credsSent) {
        credsSent = true;
        const credsPath = path.join(sessionFolder, 'creds.json');
        
        if (fs.existsSync(credsPath)) {
          try {
            // Send only once per connection
            await sock.sendMessage(sock.user.id, {
              text: '✅ Session connected successfully!'
            });
            
            await sock.sendMessage(sock.user.id, {
              document: fs.readFileSync(credsPath),
              fileName: `creds.json`,
              mimetype: 'application/json',
              caption: 'Your WhatsApp session credentials'
            });
          } catch (sendError) {
            console.error('Failed to send credentials:', sendError);
          }
        }
        
        // Don't close connection immediately
        setTimeout(() => {
          if (sock.ws.readyState !== sock.ws.CLOSED) {
            sock.ws.close();
          }
          activeConnection = null;
        }, 5000); // Give 5 seconds for messages to send
      }

      // Handle Disconnection
      if (connection === 'close') {
        activeConnection = null;
        if (lastDisconnect?.error?.output?.statusCode !== 401) {
          setTimeout(() => {
            if (!activeConnection) {
              clearSession();
            }
          }, 1000);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout handling
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR generation timed out');
        sock.ws.close();
        activeConnection = null;
      }
    }, 30000);

  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal server error');
    }
    if (activeConnection) {
      activeConnection.ws.close();
      activeConnection = null;
    }
  }
});

module.exports = router;
