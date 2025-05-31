const express = require('express');
const path = require('path');
const { toBuffer } = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys');

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3000;

// Clean session folder on start
const sessionFolder = './SESSION';
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
cleanupSession();

app.use(express.json());

router.get('/', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    let conn;

    conn = makeWASocket({
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      browser: Browsers.macOS('Safari'),
      syncFullHistory: false
    });

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      // QR Code Generation
      if (qr) {
        try {
          const qrImage = await toBuffer(qr);
          res.type('png').send(qrImage);
        } catch (qrErr) {
          console.error('QR generation error:', qrErr);
          res.status(500).send('QR generation failed');
        }
      }

      // Successful Connection
      if (connection === 'open') {
        await delay(3000); // Wait for session to stabilize
        
        try {
          const credsPath = path.join(sessionFolder, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            throw new Error('Session file not found');
          }

          const sessionData = fs.readFileSync(credsPath);
          await conn.sendMessage(conn.user.id, {
            document: sessionData,
            mimetype: 'application/json',
            fileName: `creds_${conn.user.id.replace(/[^0-9]/g, '')}.json`
          });

          await conn.sendMessage(conn.user.id, {
            text: '✅ Successfully connected!\n\n⚠️ Keep your session file secure!'
          });

          // Cleanup and close
          await delay(1000);
          conn.ws.close();
          cleanupSession();
          process.exit(0);
        } catch (sendErr) {
          console.error('Session send error:', sendErr);
          conn.ws.close();
          cleanupSession();
          process.exit(1);
        }
      }

      // Reconnection Logic
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        if (shouldReconnect) {
          await delay(5000);
          cleanupSession();
          return router.handle(req, res); // Restart the pairing process
        }
      }
    });

    conn.ev.on('creds.update', saveCreds);

    // Handle client disconnects
    req.on('close', () => {
      if (conn) conn.ws.close();
    });

  } catch (initErr) {
    console.error('Initialization error:', initErr);
    res.status(500).send('Initialization failed');
    cleanupSession();
  }
});

app.use('/', router);

app.listen(PORT, () => {
  console.log(`QR pairing server running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
});
