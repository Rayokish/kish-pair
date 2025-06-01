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
const RETRY_DELAY_MS = 5000; // 5 seconds between retries

// Enhanced connection manager
class ConnectionManager {
  constructor() {
    this.sock = null;
    this.qrGenerated = false;
    this.connectionAttempts = 0;
    this.maxAttempts = 3;
  }

  async initialize() {
    await fs.ensureDir(sessionFolder);
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    this.sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
      printQRInTerminal: false,
      syncFullHistory: false,
      shouldIgnoreJid: jid => jid === 'status@broadcast'
    });

    this.setupEventHandlers(saveCreds);
    return this.sock;
  }

  setupEventHandlers(saveCreds) {
    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr && !this.qrGenerated) {
        this.qrGenerated = true;
        this.currentQR = qr;
      }

      if (connection === 'close') {
        const shouldReconnect = await this.handleDisconnect(lastDisconnect);
        if (shouldReconnect) {
          await delay(RETRY_DELAY_MS);
          await this.initialize();
        }
      }
    });
  }

  async handleDisconnect(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    
    console.log('Connection closed:', {
      statusCode,
      error: lastDisconnect?.error?.message
    });

    // Don't reconnect on these status codes
    const fatalStatusCodes = [
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.invalidSession
    ];

    if (fatalStatusCodes.includes(statusCode)) {
      console.log('Fatal disconnect, cleaning session...');
      await fs.remove(sessionFolder);
      return false;
    }

    if (this.connectionAttempts < this.maxAttempts) {
      this.connectionAttempts++;
      console.log(`Reconnecting... (attempt ${this.connectionAttempts}/${this.maxAttempts})`);
      return true;
    }

    console.log('Max reconnection attempts reached');
    return false;
  }

  async getQRBuffer() {
    if (!this.currentQR) throw new Error('QR not generated yet');
    return toBuffer(this.currentQR);
  }

  async sendCredentials() {
    const credsPath = path.join(sessionFolder, 'creds.json');
    
    // Wait for credentials file to stabilize
    await this.waitForFile(credsPath);

    const credsData = await fs.readJson(credsPath);
    const sessionId = credsData.me?.id;

    if (!sessionId) {
      throw new Error('Invalid session data');
    }

    // Send with retry logic
    await this.retryOperation(async () => {
      await this.sock.sendMessage(this.sock.user.id, {
        text: '✅ Session connected successfully!'
      });

      await this.sock.sendMessage(this.sock.user.id, {
        document: await fs.readFile(credsPath),
        fileName: `whatsapp_creds_${Date.now()}.json`,
        mimetype: 'application/json',
        caption: 'Your WhatsApp session credentials'
      });
    }, 3);
  }

  async waitForFile(filePath, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await fs.pathExists(filePath)) {
        const stats = await fs.stat(filePath);
        if (stats.size > 0) return true;
      }
      await delay(500);
    }
    throw new Error(`File ${filePath} not found or empty after ${timeout}ms`);
  }

  async retryOperation(operation, maxRetries) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.log(`Attempt ${i + 1} failed:`, error.message);
        if (i < maxRetries - 1) await delay(1000 * (i + 1));
      }
    }
    throw lastError;
  }

  async cleanup() {
    if (this.sock) {
      try {
        this.sock.ws.close();
      } catch (e) {
        console.log('Cleanup error:', e.message);
      }
    }
  }
}

// Router implementation
router.get('/', async (req, res) => {
  const manager = new ConnectionManager();
  
  try {
    const sock = await manager.initialize();
    
    // Wait for QR generation
    await new Promise((resolve) => {
      const checkQR = setInterval(() => {
        if (manager.qrGenerated) {
          clearInterval(checkQR);
          resolve();
        }
      }, 500);
    });

    const qrBuffer = await manager.getQRBuffer();
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': qrBuffer.length
    });
    res.end(qrBuffer);

    // Handle successful connection
    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        try {
          await manager.sendCredentials();
        } catch (error) {
          console.error('Credential send failed:', error);
        } finally {
          setTimeout(() => manager.cleanup(), 5000);
        }
      }
    });

  } catch (error) {
    console.error('Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).send('Initialization failed');
    }
    await manager.cleanup();
  }
});

module.exports = router;
