const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { toBuffer } = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const SESSION_FOLDER = './session';

// Helper: read all JSON files in SESSION_FOLDER and merge into one object
async function readAuthFiles() {
  const files = await fs.promises.readdir(SESSION_FOLDER);
  const authData = {};
  for (const file of files) {
    if (file.endsWith('.json')) {
      const content = await fs.promises.readFile(path.join(SESSION_FOLDER, file), 'utf-8');
      authData[file] = JSON.parse(content);
    }
  }
  return authData;
}

router.get('/', async (req, res) => {
  try {
    if (!fs.existsSync(SESSION_FOLDER)) {
      fs.mkdirSync(SESSION_FOLDER, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    let qrSent = false;

    // Send QR code as PNG buffer on first update
    const qrTimeout = setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR timeout');
      }
    }, 120000);

    const conn = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      version,
      syncFullHistory: false,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000
    });

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr && !qrSent) {
        clearTimeout(qrTimeout);
        qrSent = true;
        try {
          const qrBuffer = await toBuffer(qr);
          if (!res.headersSent) {
            res.type('png').send(qrBuffer);
          }
        } catch (err) {
          console.error('QR generation error:', err);
          if (!res.headersSent) res.status(500).send('QR generation failed');
          conn.end();
        }
      }

      if (connection === 'open') {
        console.log('Connected successfully');
        try {
          await delay(2000);
          await saveCreds();

          // Read all auth JSON files and send to client as JSON response (if QR was sent before)
          if (!res.headersSent) {
            const authData = await readAuthFiles();
            // Send JSON with creds files
            res.json({
              message: '✅ Connection established!',
              authFiles: authData,
              warning: '⚠️ Do not share your auth files with anyone.'
            });

            // Close connection after sending creds
            await conn.end();
          } else {
            // Just keep connection alive if response already sent (rare case)
          }
        } catch (e) {
          console.error('Post-connection error:', e);
          conn.end();
        }
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error;
        console.log('Disconnected:', error?.stack || error?.message || 'Unknown reason');

        if (error?.output?.statusCode === 401) {
          // Unauthorized, session invalid - clean session folder to force new login
          try {
            await fs.promises.rm(SESSION_FOLDER, { recursive: true, force: true });
          } catch (err) {
            console.error('Cleanup error:', err);
          }
        }
      }
    });

    conn.ev.on('creds.update', saveCreds);

    req.on('close', () => {
      if (!qrSent) {
        if (!conn.destroyed) conn.end();
      }
    });

  } catch (err) {
    console.error('Initialization error:', err);
    if (!res.headersSent) {
      res.status(500).send('Connection failed: ' + err.message);
    }
  }
});

module.exports = router;
