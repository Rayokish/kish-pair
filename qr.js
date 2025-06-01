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

// Ensure session directory exists
function ensureSessionFolder() {
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }
}

router.get('/', async (req, res) => {
  ensureSessionFolder(); // Ensure folder exists before starting

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;
    let credsSent = false;

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
          sock.ws.close();
        }
      }

      // Handle Successful Connection
      if (connection === 'open' && !credsSent) {
        credsSent = true;
        const credsPath = path.join(sessionFolder, 'creds.json');
        
        // Wait briefly for file to be created
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (fs.existsSync(credsPath)) {
          try {
            // Verify file is not empty
            const stats = fs.statSync(credsPath);
            if (stats.size > 0) {
              await sock.sendMessage(sock.user.id, {
                text: '✅ Session connected successfully!'
              });
              
              await sock.sendMessage(sock.user.id, {
                document: fs.readFileSync(credsPath),
                fileName: `creds.json`,
                mimetype: 'application/json',
                caption: 'Your WhatsApp session credentials'
              });
            }
          } catch (sendError) {
            console.error('Failed to send credentials:', sendError);
          }
        }
        
        // Graceful shutdown
        setTimeout(() => {
          if (sock.ws.readyState !== sock.ws.CLOSED) {
            sock.ws.close();
          }
        }, 2000);
      }

      // Handle Disconnection
      if (connection === 'close') {
        // Optional: Add reconnection logic here if needed
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout handling
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR generation timed out');
        sock.ws.close();
      }
    }, 30000);

  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal server error');
    }
  }
});

module.exports = router;
