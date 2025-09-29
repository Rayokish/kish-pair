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

const sessionFolder = path.join(process.cwd(), 'session'); // Consistent folder name

// Global connection tracking
let activeConnection = null;
let isProcessing = false;

router.get('/', async (req, res) => {
  // Prevent multiple simultaneous connections
  if (isProcessing) {
    return res.status(429).send('Another QR process is already running');
  }

  isProcessing = true;

  try {
    // Clean previous session
    await fs.remove(sessionFolder);
    await fs.ensureDir(sessionFolder);

    // Close any existing connection
    if (activeConnection) {
      await safeClose(activeConnection);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    });

    activeConnection = sock;
    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      console.log('Connection update:', { connection, qr: !!qr });

      // Handle QR Code Generation
      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache',
            'Content-Length': qrBuffer.length
          });
          res.end(qrBuffer);
          console.log('QR code sent to client');
        } catch (error) {
          console.error('QR generation error:', error);
          if (!res.headersSent) {
            res.status(500).send('QR generation failed');
          }
        }
      }

      // Handle Successful Connection
      if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully');
        
        try {
          // Wait a bit for session to stabilize
          await delay(3000);
          
          // Send success message
          await sock.sendMessage(sock.user.id, {
            text: '🎉 *KISH-MD Session Connected!*\n\nYour credentials file is being prepared...'
          });

          // Wait for creds.json to be properly saved
          await waitForStableFile(path.join(sessionFolder, 'creds.json'), 10000);

          // Read and send credentials file
          const credsPath = path.join(sessionFolder, 'creds.json');
          if (await fs.pathExists(credsPath)) {
            const credsData = await fs.readFile(credsPath);
            const fileStats = await fs.stat(credsPath);
            
            console.log(`Creds file size: ${fileStats.size} bytes`);
            
            if (fileStats.size > 100) { // Ensure file has substantial content
              await sock.sendMessage(sock.user.id, {
                document: credsData,
                fileName: 'creds.json',
                mimetype: 'application/json'
              });

              await sock.sendMessage(sock.user.id, {
                text: `✅ *Credentials File Sent!*\n\n📁 File: creds.json\n💾 Size: ${(fileStats.size / 1024).toFixed(2)} KB\n\n⚠️ *SECURITY WARNING:*\n• Keep this file safe and private\n• Do not share with anyone\n• This file contains your WhatsApp session`
              });

              console.log('✅ Credentials file sent successfully');
            } else {
              throw new Error('Creds file too small, likely incomplete');
            }
          } else {
            throw new Error('Creds file not found');
          }

          // Send final success message
          await sock.sendMessage(sock.user.id, {
            text: '🚀 *Setup Complete!*\n\nYou can now use your KISH-MD bot with these credentials. The session will automatically close in 10 seconds.'
          });

        } catch (error) {
          console.error('Error sending credentials:', error);
          await sock.sendMessage(sock.user.id, {
            text: `❌ *Error sending credentials:* ${error.message}\n\nPlease try scanning the QR code again.`
          });
        } finally {
          // Close connection after a delay
          setTimeout(async () => {
            await safeClose(sock);
            isProcessing = false;
          }, 10000);
        }
      }

      // Handle Connection Errors
      if (connection === 'close') {
        console.log('Connection closed:', {
          status: lastDisconnect?.error?.output?.statusCode,
          error: lastDisconnect?.error?.message
        });

        const shouldCleanup = [
          DisconnectReason.loggedOut,
          DisconnectReason.badSession,
          DisconnectReason.invalidSession
        ].includes(lastDisconnect?.error?.output?.statusCode);

        if (shouldCleanup) {
          await fs.remove(sessionFolder);
          console.log('Cleaned up invalid session');
        }

        isProcessing = false;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle request timeout
    req.on('close', () => {
      console.log('Client disconnected');
      isProcessing = false;
    });

    // QR generation timeout
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR generation timeout');
        safeClose(sock);
        isProcessing = false;
      }
    }, 30000);

  } catch (error) {
    console.error('Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).send('Server error during initialization');
    }
    isProcessing = false;
    await safeClose(activeConnection);
  }
});

// Helper Functions
async function safeClose(sock) {
  if (!sock) return;
  
  try {
    if (sock.ws && sock.ws.readyState !== sock.ws.CLOSED) {
      sock.ws.close();
    }
  } catch (e) {
    console.log('Close error:', e.message);
  } finally {
    activeConnection = null;
  }
}

async function waitForStableFile(filePath, timeout = 10000) {
  const start = Date.now();
  let lastSize = 0;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    try {
      if (await fs.pathExists(filePath)) {
        const stats = await fs.stat(filePath);
        
        if (stats.size > 0) {
          if (stats.size === lastSize) {
            stableCount++;
            if (stableCount >= 2) { // File size stable for 2 checks
              return true;
            }
          } else {
            stableCount = 0;
            lastSize = stats.size;
          }
        }
      }
      await delay(500);
    } catch (error) {
      // File might be temporarily unavailable during write
      await delay(500);
    }
  }
  
  throw new Error(`File not stable after ${timeout}ms`);
}

module.exports = router;
