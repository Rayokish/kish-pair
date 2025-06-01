const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { toBuffer } = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_FOLDER = './SESSION;

// Ensure session folder exists
if (!fs.existsSync(SESSION_FOLDER)) {
  fs.mkdirSync(SESSION_FOLDER);
}

// Clean session folder
async function cleanupSession() {
  if (fs.existsSync(SESSION_FOLDER)) {
    await fs.promises.rm(SESSION_FOLDER, { recursive: true, force: true });
    console.log('Session cleaned');
  }
}

// GET QR API
app.get('/qr-api', async (req, res) => {
  await cleanupSession();

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  let qrSent = false;

  const conn = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    version,
    syncFullHistory: false
  });

  conn.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr && !qrSent) {
      try {
        const qrBuffer = await toBuffer(qr);
        qrSent = true;
        res.set('Content-Type', 'image/png');
        res.send(qrBuffer);
      } catch (err) {
        console.error('QR generation failed:', err);
        res.status(500).send('QR generation failed');
        conn.end();
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp Connected');
      await saveCreds();
      await delay(1000);

      // Send creds.json as downloadable file
      const credsPath = path.join(SESSION_FOLDER, 'creds.json');
      if (fs.existsSync(credsPath)) {
        res.download(credsPath, 'creds.json');
      } else {
        res.status(500).send('Credentials file not found');
      }

      await delay(2000);
      await conn.end();
      await cleanupSession();
    }

    if (connection === 'close') {
      console.log('❌ Disconnected:', lastDisconnect?.error?.message || 'Unknown');
    }
  });

  conn.ev.on('creds.update', saveCreds);

  // Abort QR if client closes connection
  req.on('close', () => {
    if (!qrSent) {
      conn.end();
      cleanupSession();
      console.log('Client disconnected before scanning QR');
    }
  });
});

// Root
app.get('/', (req, res) => {
  res.send('✅ Server is running. Use /qr-api to get WhatsApp QR.');
});

// Start
app.listen(PORT, () => {
  console.log(`✅ Server started at http://localhost:${PORT}`);
});
