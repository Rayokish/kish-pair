// qr.js
const express = require('express');
const path = require('path');
const { toBuffer } = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys');

const router = express.Router();

const sessionFolder = './SESSION';

// Utility to clean session
const cleanupSession = () => {
  if (fs.existsSync(sessionFolder)) {
    try {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
      console.log('Cleaned previous session');
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  }
};

router.get('/', async (req, res) => {
  try {
    cleanupSession();

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const conn = makeWASocket({
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
      syncFullHistory: false
    });

    let responded = false;

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr && !responded) {
        responded = true;
        try {
          const qrImage = await toBuffer(qr);
          res.type('png').send(qrImage);
        } catch (qrErr) {
          console.error('QR generation error:', qrErr);
          res.status(500).send('QR generation failed');
        }
      }

      if (connection === 'open') {
        await delay(3000);
        try {
          const credsPath = path.join(sessionFolder, 'creds.json');
          const sessionData = fs.readFileSync(credsPath);

          await conn.sendMessage(conn.user.id, {
            document: sessionData,
            mimetype: 'application/json',
            fileName: `creds_${conn.user.id.replace(/[^0-9]/g, '')}.json`
          });

          await conn.sendMessage(conn.user.id, {
            text: '✅ Successfully connected!\n\n⚠️ Keep your session file secure!'
          });

          await delay(1000);
          conn.ws.close();
          cleanupSession();
        } catch (sendErr) {
          console.error('Session send error:', sendErr);
          conn.ws.close();
          cleanupSession();
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        if (shouldReconnect) {
          await delay(5000);
          cleanupSession();
        }
      }
    });

    conn.ev.on('creds.update', saveCreds);

    req.on('close', () => {
      if (conn) conn.ws.close();
    });

  } catch (err) {
    console.error('QR route error:', err);
    res.status(500).send('Initialization failed');
    cleanupSession();
  }
});

module.exports = router;
