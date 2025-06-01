const express = require('express');
const fs = require('fs');
const path = require('path');
const { toBuffer } = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const router = express.Router();
const PORT = 3000;

const SESSION_DIR = './SESSION';

if (fs.existsSync(SESSION_DIR)) {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    console.log('Deleted the "SESSION" folder at startup.');
  } catch (err) {
    console.error('Error deleting the "SESSION" folder:', err);
  }
}

router.get('/', async (req, res) => {
  // Prevent multiple QR sends in same request
  let qrSent = false;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
      logger: pino({ level: 'fatal' }),
      browser: ['Brashokish', 'Safari', '3.0'],
    });

    // Listen for connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('Connection update:', connection);

      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrImageBuffer = await toBuffer(qr);
          res.type('png').send(qrImageBuffer);
        } catch (e) {
          console.error('Failed to send QR buffer:', e);
          if (!res.headersSent) res.status(500).send('Failed to generate QR');
        }
      }

      if (connection === 'open') {
        console.log('WhatsApp connection opened!');
        if (!res.headersSent) res.end('Authenticated');

        // Optional: Send message or do something on connection open
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== 401 &&
          lastDisconnect?.error?.message !== 'Stream Errored (conflict)';

        console.log('Connection closed:', lastDisconnect?.error?.message || 'No error info');

        if (shouldReconnect) {
          console.log('Reconnecting...');
          await delay(5000);
          sock.ws.close(); // Close current socket
          // We do NOT call the function recursively here since this is a single route handler
          // The user can refresh the QR page to restart the process
        } else {
          console.log('Session invalid or conflict, please re-authenticate.');
          // Optionally delete session folder here to force fresh login next time
          try {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('Deleted SESSION folder due to invalid session or conflict.');
          } catch (err) {
            console.error('Failed to delete session folder:', err);
          }
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error('Error in QR route:', err);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});

app.use('/qr-api', router);

app.listen(PORT, () => {
  console.log(`QR API Server running on port ${PORT}`);
  console.log(`Use http://localhost:${PORT}/qr-api to get QR`);
});
