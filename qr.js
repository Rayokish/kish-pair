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

// Delete SESSION folder on startup
const sessionFolder = path.join(__dirname, 'SESSION');
if (fs.existsSync(sessionFolder)) {
  try {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
    console.log('Deleted the "SESSION" folder at startup.');
  } catch (err) {
    console.error('Error deleting the "SESSION" folder:', err);
  }
}

router.get('/qr-api', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./SESSION');

    const sock = makeWASocket({
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let sentQR = false;
    let isConnected = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr && !sentQR && !isConnected) {
        sentQR = true; // only send once

        // Convert QR string to PNG buffer
        const qrImageBuffer = await toBuffer(qr);

        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': qrImageBuffer.length,
        });
        return res.end(qrImageBuffer);
      }

      if (connection === 'open') {
        isConnected = true;
        const credsPath = path.join(__dirname, 'SESSION', 'creds.json');

        if (fs.existsSync(credsPath)) {
          const credsData = fs.readFileSync(credsPath, 'utf8');
          const sessionId = JSON.parse(credsData);
          
          // You might want to store this session ID in a database or send it to the client
          console.log('Session ID (creds.json):', sessionId);
        }

        // Once connected, close the socket
        sock.ws.close();
      }

      if (
        connection === 'close' &&
        lastDisconnect?.error?.output?.statusCode !== 401
      ) {
        sock.end();
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // In case QR is never received, set timeout to close the response
    setTimeout(() => {
      if (!sentQR && !res.headersSent) {
        res.status(408).send('QR code generation timeout');
        sock.ws.close();
      }
    }, 30000); // 30 seconds timeout

  } catch (error) {
    console.error('Error in /qr-api:', error);
    if (!res.headersSent) res.status(500).send({ error: error.message });
  }
});

// New endpoint to get the session ID (creds.json)
router.get('/session-id', (req, res) => {
  try {
    const credsPath = path.join(__dirname, 'SESSION', 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
      return res.status(404).send({ error: 'Session not established yet' });
    }

    const credsData = fs.readFileSync(credsPath, 'utf8');
    const sessionId = JSON.parse(credsData);
    
    res.send({ sessionId });
  } catch (error) {
    console.error('Error in /session-id:', error);
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
