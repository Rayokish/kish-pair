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

// Enhanced async cleanup
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

    // 2 minute timeout
    const qrTimeout = setTimeout(() => {
      if (!qrSent) {
        res.status(408).send('QR timeout');
        if (conn) conn.end();
        cleanupSession();
      }
    }, 120000);

    conn = makeWASocket({
      // Removed deprecated printQRInTerminal
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      version: [2, 2413, 1] // Stable version
    });

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      // Handle QR code generation
      if (qr && !qrSent) {
        try {
          clearTimeout(qrTimeout);
          qrSent = true;
          console.log('Generating QR code...'); // Debug log
          
          const qrBuffer = await toBuffer(qr);
          res.type('png').send(qrBuffer);
        } catch (qrErr) {
          console.error('QR generation error:', qrErr);
          if (!res.headersSent) res.status(500).send('QR generation failed');
        }
      }

      // Handle successful connection
      if (connection === 'open') {
        console.log('Connected successfully');
        await delay(2000); // Short delay for stability

        try {
          // Save credentials explicitly
          await saveCreds();
          
          const credsPath = path.join(SESSION_FOLDER, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            throw new Error('creds.json not found');
          }

          // Send success message
          await conn.sendMessage(conn.user.id, {
            text: '✅ Connected successfully!\n\n' +
                  '⚠️ Session established securely\n\n' +
                  '🔒 Your credentials are saved in the session folder'
          });

          // Clean up
          await conn.end();
          await cleanupSession();
        } catch (sendErr) {
          console.error('Session error:', sendErr);
          if (conn) conn.end();
          await cleanupSession();
        }
      }

      // Handle disconnection
      if (connection === 'close') {
        console.log('Disconnected:', lastDisconnect?.error?.message || 'Unknown reason');
        await cleanupSession();
      }
    });

    // Handle credentials updates
    conn.ev.on('creds.update', saveCreds);

    // Handle client disconnection
    req.on('close', () => {
      if (!qrSent && conn) {
        conn.end();
        cleanupSession();
      }
    });

  } catch (initErr) {
    console.error('Initialization error:', initErr);
    if (!res.headersSent) {
      res.status(500).send('Initialization failed');
    }
    await cleanupSession();
  }
});

module.exports = router;
