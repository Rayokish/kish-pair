const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const { toBuffer } = require('qrcode');
const { delay } = require('@whiskeysockets/baileys');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const sessionFolder = path.join(process.cwd(), 'SESSION');
const RETRY_DELAY_MS = 10000; // Increased to 10 seconds between retries

// Track connection state globally
let activeConnection = null;
let isSendingCreds = false;

router.get('/', async (req, res) => {
  try {
    await fs.ensureDir(sessionFolder);
    
    // Clean up any existing connection
    if (activeConnection) {
      await safeClose(activeConnection);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      logger: pino({ level: 'error' }), // More verbose logging for errors
      auth: state,
      browser: Browsers.macOS('Safari'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldIgnoreJid: jid => jid === 'status@broadcast',
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000
    });

    activeConnection = sock;
    let qrGenerated = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      // Handle QR Generation
      if (qr && !qrGenerated) {
        qrGenerated = true;
        try {
          const qrBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrBuffer.length
          });
          res.end(qrBuffer);
        } catch (error) {
          console.error('QR generation failed:', error);
          if (!res.headersSent) {
            res.status(500).send('Failed to generate QR');
          }
          await safeClose(sock);
        }
      }

      // Handle Successful Connection
      if (connection === 'open' && !isSendingCreds) {
        isSendingCreds = true;
        console.log('Connection established, sending credentials...');
        
        try {
          await sendCredentialsWithRetry(sock);
          console.log('Credentials sent successfully');
        } catch (error) {
          console.error('Failed to send credentials:', error);
        } finally {
          isSendingCreds = false;
          // Don't close immediately - give time for messages to deliver
          setTimeout(() => safeClose(sock), 10000);
        }
      }

      // Handle Disconnection
      if (connection === 'close') {
        console.log('Connection closed:', {
          statusCode: lastDisconnect?.error?.output?.statusCode,
          error: lastDisconnect?.error?.message
        });

        // Don't reconnect on these errors
        const fatalCodes = [
          DisconnectReason.loggedOut,
          DisconnectReason.badSession,
          DisconnectReason.invalidSession
        ];

        if (fatalCodes.includes(lastDisconnect?.error?.output?.statusCode)) {
          console.log('Fatal error, cleaning session...');
          await fs.remove(sessionFolder);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout handling
    setTimeout(() => {
      if (!qrGenerated && !res.headersSent) {
        res.status(408).send('QR generation timed out');
        safeClose(sock);
      }
    }, 30000);

  } catch (error) {
    console.error('Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal server error');
    }
    await safeClose(activeConnection);
  }
});

// Helper functions
async function safeClose(sock) {
  if (!sock) return;
  
  try {
    if (sock.ws && sock.ws.readyState !== sock.ws.CLOSED) {
      sock.ws.close();
    }
  } catch (e) {
    console.log('Safe close error:', e.message);
  } finally {
    if (activeConnection === sock) {
      activeConnection = null;
    }
  }
}

async function sendCredentialsWithRetry(sock, maxRetries = 3) {
  const credsPath = path.join(sessionFolder, 'creds.json');
  
  // Wait for file to be stable
  await waitForFile(credsPath);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Verify connection is still active
      if (!sock.user?.id) {
        throw new Error('No active user session');
      }

      // Send success message
      await sock.sendMessage(sock.user.id, {
        text: '✅ Session connected successfully!'
      });

      // Send credentials file
      await sock.sendMessage(sock.user.id, {
        document: await fs.readFile(credsPath),
        fileName: `whatsapp_creds_${Date.now()}.json`,
        mimetype: 'application/json',
        caption: 'Your WhatsApp session credentials'
      });

      return; // Success - exit retry loop
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      
      // Wait longer between each retry
      await delay(2000 * attempt);
      
      // Refresh connection state
      if (!sock.user?.id) {
        throw new Error('Connection lost during retry');
      }
    }
  }
}

async function waitForFile(filePath, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fs.pathExists(filePath)) {
      const stats = await fs.stat(filePath);
      if (stats.size > 0) return;
    }
    await delay(500);
  }
  throw new Error(`File ${filePath} not ready after ${timeout}ms`);
}

module.exports = router;
