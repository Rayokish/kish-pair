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

const SESSION_FOLDER = './SESSION';

// Session cleanup function
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

// Connection retry logic
async function connectWithRetry(connectFn, maxRetries = 3, retryDelay = 5000) {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      return await connectFn();
    } catch (err) {
      retries++;
      console.error(`Connection attempt ${retries} failed:`, err.message);
      if (retries < maxRetries) {
        console.log(`Retrying in ${retryDelay / 1000} seconds...`);
        await delay(retryDelay);
        await cleanupSession();
        await delay(1000);
      }
    }
  }
  throw new Error(`Max retries (${maxRetries}) reached`);
}

router.get('/', async (req, res) => {
  await cleanupSession();
  await delay(1000);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();
    let conn = null;
    let qrSent = false;

    const qrTimeout = setTimeout(() => {
      if (!qrSent) {
        if (!res.headersSent) res.status(408).send('QR timeout');
        if (conn) conn.end();
        cleanupSession();
      }
    }, 120000); // 2 minutes

    const connectFn = async () => {
      conn = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: {
          creds: state.creds,
          keys: state.keys
        },
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        version: version,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 15000
      });

      conn.ev.on('connection.update', async (update) => {
        const { qr, connection, lastDisconnect } = update;

        if (qr && !qrSent) {
          try {
            clearTimeout(qrTimeout);
            qrSent = true;
            console.log('QR code generated');
            const qrBuffer = await toBuffer(qr);
            res.type('png').send(qrBuffer);
          } catch (qrErr) {
            console.error('QR generation error:', qrErr);
            if (!res.headersSent) res.status(500).send('QR generation failed');
          }
        }

        if (connection === 'open') {
          console.log('Connected successfully');
          await delay(2000);
          try {
            await saveCreds();

            const credsPath = path.join(SESSION_FOLDER, 'creds.json');
            if (!fs.existsSync(credsPath)) throw new Error('creds.json not found');

            await conn.sendMessage(conn.user.id, {
              text: '✅ Connection established!\n\n⚠️ Do not share your session data with anyone.'
            });

            await conn.end();
            await cleanupSession();
          } catch (err) {
            console.error('Post-connection error:', err);
            if (conn) conn.end();
            await cleanupSession();
          }
        }

        if (connection === 'close') {
          const error = lastDisconnect?.error;
          console.log('Disconnected:', error?.message || 'Unknown reason');

          if (error?.output?.statusCode !== 401) {
            console.log('Attempting reconnect...');
            await delay(5000);
            await connectWithRetry(connectFn);
          } else {
            console.log('401 Unauthorized. Cleaning session...');
            await cleanupSession();
          }
        }
      });

      conn.ev.on('creds.update', saveCreds);
    };

    await connectWithRetry(connectFn);

    req.on('close', () => {
      if (!qrSent && conn) {
        conn.end();
        cleanupSession();
      }
    });

  } catch (err) {
    console.error('Initialization error:', err);
    if (!res.headersSent) {
      res.status(500).send('Connection failed: ' + err.message);
    }
    await cleanupSession();
  }
});

module.exports = router;
