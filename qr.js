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
  Browsers,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const SESSION_FOLDER = './SESSION';

const cleanupSession = () => {
  if (fs.existsSync(SESSION_FOLDER)) {
    try {
      fs.rmSync(SESSION_FOLDER, { recursive: true, force: true });
      console.log('Cleaned up previous session');
    } catch (err) {
      console.error('Session cleanup error:', err);
    }
  }
};

router.get('/', async (req, res) => {
  cleanupSession();

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    let conn = null;
    let qrSent = false;

    const qrTimeout = setTimeout(() => {
      if (!qrSent) {
        res.status(408).send('QR timeout');
        if (conn) conn.ws.close();
        cleanupSession();
      }
    }, 180000);

    conn = makeWASocket({
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      browser: Browsers.macOS('Safari'),
      syncFullHistory: false
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
          console.error('QR generation error:', qrErr);
          if (!res.headersSent) res.status(500).send('QR generation failed');
        }
      }

      if (connection === 'open') {
        console.log('Connected successfully');
        await delay(3000);

        try {
          const credsPath = path.join(SESSION_FOLDER, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            throw new Error('Session file not found');
          }

          const sessionData = fs.readFileSync(credsPath);
          await conn.sendMessage(conn.user.id, {
            document: sessionData,
            fileName: `whatsapp_session_${conn.user.id.replace(/[^0-9]/g, '')}.json`,
            mimetype: 'application/json'
          });

          await conn.sendMessage(conn.user.id, {
            text: '✅ Successfully connected!\n\n' +
              '⚠️ Keep your session file secure!\n\n' +
              '🔒 Do not share with anyone!'
          });

          await delay(1000);
          conn.ws.close();
          cleanupSession();
        } catch (sendErr) {
          console.error('Session send error:', sendErr);
          if (conn) conn.ws.close();
          cleanupSession();
        }
      }

      if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log('Reconnecting...');
        await delay(5000);
        cleanupSession();
        return res.redirect('/qr');
      }
    });

    conn.ev.on('creds.update', saveCreds);

    req.on('close', () => {
      if (!qrSent) {
        clearTimeout(qrTimeout);
        if (conn) conn.ws.close();
        cleanupSession();
      }
    });

  } catch (initErr) {
    console.error('Initialization error:', initErr);
    if (!res.headersSent) res.status(500).send('Initialization failed');
    cleanupSession();
  }
});

module.exports = router;
