
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require("@whiskeysockets/baileys");

const SESSION_PATH = './session';
const logger = pino({ level: 'silent' }).child({ level: 'silent' });

// Cleanup session
const cleanupSession = async () => {
  if (fs.existsSync(SESSION_PATH)) {
    try {
      await fs.promises.rm(SESSION_PATH, { recursive: true, force: true });
      console.log('✅ Session cleaned');
    } catch (err) {
      console.error('⚠️ Cleanup failed:', err);
    }
  }
};

// Retry wrapper
async function connectWithRetry(connectFn, maxRetries = 3, delayMs = 5000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await connectFn();
    } catch (err) {
      retries++;
      console.error(`Retry ${retries} failed:`, err.message);
      if (retries < maxRetries) {
        await delay(delayMs);
        await cleanupSession();
      }
    }
  }
  throw new Error('❌ Max retries reached');
}

router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ error: "Number is required" });

  await cleanupSession();

  let sock;
  let qrSent = false;

  const timeout = setTimeout(() => {
    if (!qrSent) {
      res.status(408).send("QR scan timeout.");
      if (sock) sock.end();
    }
  }, 2 * 60 * 1000);

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    sock = makeWASocket({
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      version: [2, 2413, 1],
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr && !qrSent) {
        qrSent = true;
        const { toBuffer } = require('qrcode');
        try {
          const qrImage = await toBuffer(qr);
          clearTimeout(timeout);
          res.setHeader('Content-Type', 'image/png');
          return res.end(qrImage);
        } catch (err) {
          console.error("QR Code Error:", err);
          res.status(500).send("QR generation failed.");
        }
      }

      if (connection === "open") {
        console.log("✅ Connected");
        await saveCreds();
        await delay(3000);
        await sock.sendMessage(sock.user.id, {
          text: '✅ Connected successfully!
Do not share your session.'
        });
        await delay(3000);
        await sock.end();
        await cleanupSession();
      }

      if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        console.log("Disconnected:", lastDisconnect?.error?.message || "Unknown");

        if (shouldReconnect) {
          await delay(5000);
          await cleanupSession();
          await connect();
        } else {
          await cleanupSession();
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
  };

  try {
    await connectWithRetry(connect);
  } catch (err) {
    console.error("Fatal connection error:", err);
    if (!res.headersSent) res.status(500).send("Failed to connect: " + err.message);
    await cleanupSession();
  }

  req.on('close', () => {
    if (!qrSent && sock) {
      sock.end();
      cleanupSession();
    }
  });
});

module.exports = router;
