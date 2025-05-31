const express = require('express');
const router = express.Router();
const path = require('path');
const { toBuffer } = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers
} = require('@whiskeysockets/baileys');

const SESSION_FOLDER = './SESSION';

// Enhanced cleanup with async/await
const cleanupSession = async () => {
  if (fs.existsSync(SESSION_FOLDER)) {
    try {
      await fs.promises.rm(SESSION_FOLDER, { recursive: true, force: true });
      console.log('Session cleaned successfully');
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  }
};

router.get('/', async (req, res) => {
  await cleanupSession();

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    let conn = null;
    let qrSent = false;

    const qrTimeout = setTimeout(() => {
      if (!qrSent) {
        res.status(408).send('QR timeout');
        if (conn) conn.end();
        cleanupSession();
      }
    }, 120000); // Reduced timeout to 2 minutes

    conn = makeWASocket({
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: state.keys, // Removed makeCacheableSignalKeyStore
      },
      browser: Browsers.ubuntu('Chrome'), // Changed to desktop browser
      syncFullHistory: false,
      version: [2, 2413, 1] // Specify a supported version
    });

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr && !qrSent) {
        try {
          clearTimeout(qrTimeout);
          qrSent = true;
          const qrBuffer = await toBuffer(qr);
          res.type('png').send(qrBuffer);
        } catch (qrErr) {
          console.error('QR error:', qrErr);
          if (!res.headersSent) res.status(500).send('QR failed');
        }
      }

      if (connection === 'open') {
        console.log('Connected!');
        await delay(2000);

        try {
          // Ensure credentials are saved
          await saveCreds();
          
          const credsPath = path.join(SESSION_FOLDER, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            throw new Error('No credentials found');
          }

          const sessionData = fs.readFileSync(credsPath);
          await conn.sendMessage(conn.user.id, {
            text: '✅ Connection successful!\n\n' +
                  '⚠️ Save your session file securely'
          });

          await conn.end();
          await cleanupSession();
        } catch (e) {
          console.error('Session error:', e);
          if (conn) conn.end();
          await cleanupSession();
        }
      }

      if (connection === 'close') {
        console.log('Disconnected');
        await cleanupSession();
      }
    });

    conn.ev.on('creds.update', saveCreds);

    req.on('close', () => {
      if (!qrSent && conn) {
        conn.end();
        cleanupSession();
      }
    });

  } catch (err) {
    console.error('Initial error:', err);
    if (!res.headersSent) {
      res.status(500).send('Connection failed');
    }
    await cleanupSession();
  }
});

module.exports = router;
