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

// Improved cleanup function
const cleanupSession = async () => {
  if (fs.existsSync(SESSION_FOLDER)) {
    try {
      await fs.promises.rm(SESSION_FOLDER, { recursive: true, force: true });
      console.log('Session cleanup successful');
    } catch (err) {
      console.error('Session cleanup error:', err);
    }
  }
};

// Device linking information
const DEVICE_INFO = {
  deviceName: 'MyWhatsAppDevice', // Customize this
  deviceType: 'android', // or 'ios', 'desktop'
  browser: Browsers.macOS('Safari')
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
    }, 180000);

    conn = makeWASocket({
      printQRInTerminal: true, // Keep this true for debugging
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      browser: DEVICE_INFO.browser,
      syncFullHistory: false,
      mobile: DEVICE_INFO.deviceType !== 'desktop', // Set mobile flag
      markOnlineOnConnect: true // Better device linking
    });

    conn.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect, isNewLogin } = update;

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
        await delay(3000); // Wait for full connection

        try {
          // Save credentials explicitly
          await saveCreds();

          // Verify creds.json exists
          const credsPath = path.join(SESSION_FOLDER, 'creds.json');
          if (!fs.existsSync(credsPath)) {
            throw new Error('creds.json not found after connection');
          }

          // Read and send session data
          const sessionData = fs.readFileSync(credsPath);
          
          // Send session file to user
          await conn.sendMessage(conn.user.id, {
            document: sessionData,
            fileName: `whatsapp_session_${conn.user.id.replace(/[^0-9]/g, '')}.json`,
            mimetype: 'application/json'
          });

          // Send confirmation message
          await conn.sendMessage(conn.user.id, {
            text: `✅ Successfully connected as ${DEVICE_INFO.deviceName}!\n\n` +
                  '⚠️ Keep your session file secure!\n\n' +
                  '🔒 Do not share with anyone!'
          });

          // Clean up after sending
          await delay(1000);
          conn.end();
          await cleanupSession();
        } catch (sendErr) {
          console.error('Session send error:', sendErr);
          if (conn) conn.end();
          await cleanupSession();
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        console.log(`Connection closed. ${shouldReconnect ? 'Reconnecting...' : 'Login expired.'}`);
        
        if (shouldReconnect) {
          await delay(5000);
          await cleanupSession();
          if (!res.headersSent) res.redirect('/qr');
        } else {
          await cleanupSession();
        }
      }

      // Handle new logins for better device linking
      if (isNewLogin) {
        console.log('New device linked successfully');
      }
    });

    // Handle credentials updates
    conn.ev.on('creds.update', saveCreds);

    // Handle client disconnection
    req.on('close', () => {
      if (!qrSent) {
        clearTimeout(qrTimeout);
        if (conn) conn.end();
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
