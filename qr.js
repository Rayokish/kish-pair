const express = require('express');
const path = require('path');
const { toBuffer } = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const { exec } = require('child_process');

// Baileys imports
const { 
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers
} = require('@whiskeysockets/baileys');

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3000;

// Session management
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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// QR Route
router.get('/', async (req, res) => {
  cleanupSession(); // Start fresh each time
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    let conn = null;

    const startTime = Date.now();
    let qrSent = false;

    // QR timeout (3 minutes)
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
      syncFullHistory: false,
      shouldIgnoreJid: jid => jid?.endsWith('@g.us')
    });

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      // Send QR code
      if (qr && !qrSent) {
        try {
          clearTimeout(qrTimeout);
          qrSent = true;
          const qrBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrBuffer.length
          });
          res.end(qrBuffer);
        } catch (qrErr) {
          console.error('QR generation error:', qrErr);
          if (!res.headersSent) res.status(500).send('QR generation failed');
        }
      }

      // On successful connection
      if (connection === 'open') {
        console.log('Connected successfully');
        await delay(3000); // Small delay for stability

        try {
          const credsPath = path.join(SESSION_FOLDER, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            throw new Error('Session file not found');
          }

          const sessionData = fs.readFileSync(credsPath);
          await conn.sendMessage(conn.user.id, {
            document: sessionData,
            fileName: `whatsapp_session_${conn.user.id}.json`,
            mimetype: 'application/json'
          });

          await conn.sendMessage(conn.user.id, {
            text: '✅ Successfully connected!\n\n' +
                  '⚠️ Keep your session file secure!\n\n' +
                  '🔒 Do not share with anyone!'
          });

          // Cleanup
          await delay(1000);
          conn.ws.close();
          cleanupSession();
          console.log(`Session completed in ${(Date.now() - startTime)/1000} seconds`);

        } catch (sendErr) {
          console.error('Session send error:', sendErr);
          if (conn) conn.ws.close();
          cleanupSession();
        }
      }

      // Handle reconnection
      if (connection === 'close' && 
          lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log('Reconnecting...');
        await delay(5000);
        conn = null;
        cleanupSession();
        router.handle(req, res); // Restart the process
      }
    });

    conn.ev.on('creds.update', saveCreds);

    // Handle client errors
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

app.use('/', router);

app.listen(PORT, () => {
  console.log(`QR pairing service running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
});

// Handle process cleanup
process.on('SIGINT', () => {
  cleanupSession();
  process.exit();
});
