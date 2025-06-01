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
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const SESSION_FOLDER = './session';  // lowercase folder name (change if your folder is uppercase)

// Ensure session folder exists (create it if missing)
if (!fs.existsSync(SESSION_FOLDER)) {
  fs.mkdirSync(SESSION_FOLDER, { recursive: true });
}

// Cleanup session folder - call this only when you want to reset session completely
async function cleanupSession() {
  if (fs.existsSync(SESSION_FOLDER)) {
    try {
      await fs.promises.rm(SESSION_FOLDER, { recursive: true, force: true });
      console.log('Session cleaned successfully');
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  }
}

// Retry connection helper
async function connectWithRetry(connectFn, maxRetries = 3, retryDelay = 5000) {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const conn = await connectFn();
      return conn;
    } catch (err) {
      retries++;
      console.error(`Connection attempt ${retries} failed:`, err.message);
      if (retries < maxRetries) {
        console.log(`Retrying in ${retryDelay / 1000} seconds...`);
        await delay(retryDelay);
        // Only cleanup session here if you want a fresh login after failure
        // await cleanupSession();
        // And recreate the session folder before next connect attempt
        if (!fs.existsSync(SESSION_FOLDER)) {
          fs.mkdirSync(SESSION_FOLDER, { recursive: true });
        }
      }
    }
  }

  throw new Error(`Max retries (${maxRetries}) reached`);
}

router.get('/', async (req, res) => {
  try {
    // Ensure session folder exists before useMultiFileAuthState
    if (!fs.existsSync(SESSION_FOLDER)) {
      fs.mkdirSync(SESSION_FOLDER, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    let qrSent = false;

    const qrTimeout = setTimeout(() => {
      if (!qrSent) {
        res.status(408).send('QR timeout');
      }
    }, 120000);

    const connectFn = () => new Promise((resolve, reject) => {
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
          console.log('QR code generated');
          try {
            const qrBuffer = await toBuffer(qr);
            if (!res.headersSent) {
              res.type('png').send(qrBuffer);
            }
          } catch (qrErr) {
            console.error('QR generation error:', qrErr);
            if (!res.headersSent) res.status(500).send('QR generation failed');
            conn.end();
            reject(qrErr);
          }
        }

        if (connection === 'open') {
          console.log('Connected successfully');
          try {
            await delay(2000);
            await saveCreds();

            // Send a welcome message to self
            await conn.sendMessage(conn.user.id, {
              text: '✅ Connection established!\n\n⚠️ Do not share your session data with anyone.'
            });

            resolve(conn);  // Resolve the promise to indicate successful connection
          } catch (e) {
            console.error('Post-connection error:', e);
            conn.end();
            reject(e);
          }
        }

        if (connection === 'close') {
          const error = lastDisconnect?.error;
          console.log('Disconnected:', error?.stack || error?.message || 'Unknown reason');

          if (error?.output?.statusCode === 401) {
            // Unauthorized, session invalid - cleanup and reject without retry
            await cleanupSession();
            reject(new Error('Unauthorized, session invalid'));
          } else {
            // For other errors, reject to trigger retry
            reject(error || new Error('Connection closed'));
          }
        }
      });

      conn.ev.on('creds.update', saveCreds);

      // Handle client disconnect early (before QR scanned)
      req.on('close', () => {
        if (!qrSent) {
          if (!conn.destroyed) conn.end();
          // Do not cleanup session here to avoid deleting folder while auth is ongoing
          reject(new Error('Client closed connection before QR scan'));
        }
      });
    });

    const conn = await connectWithRetry(connectFn);

    // You can keep the session alive after connection success
    // or close it if you want cleanup on each connection

    // Here: close connection and clean session (optional)
    await conn.end();
    // Uncomment to clean session after connection ends
    // await cleanupSession();

  } catch (err) {
    console.error('Initialization error:', err);
    if (!res.headersSent) {
      res.status(500).send('Connection failed: ' + err.message);
    }
    // Do not cleanup session here forcibly, unless you want a full reset on error
    // await cleanupSession();
  }
});

module.exports = router;
