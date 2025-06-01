const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');
const { toBuffer } = require('qrcode');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');

// Clear session on startup
const clearSession = () => {
  const sessionFolder = path.join(__dirname, 'SESSION');
  if (fs.existsSync(sessionFolder)) {
    try {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
      console.log('Session folder cleared');
    } catch (err) {
      console.error('Error clearing session:', err);
    }
  }
};
clearSession();

router.get('/qr-api', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./SESSION');

    const sock = makeWASocket({
      printQRInTerminal: true, // Enable terminal QR for debugging
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrGenerated = false;
    let connectionTimeout;

    const cleanup = () => {
      clearTimeout(connectionTimeout);
      if (sock.ws && sock.ws.readyState !== sock.ws.CLOSED) {
        sock.ws.close();
      }
    };

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr && !qrGenerated) {
        qrGenerated = true;
        clearTimeout(connectionTimeout);

        try {
          const qrImage = await QRCode.toDataURL(qr);
          res.json({
            status: 'QR_READY',
            qr: qrImage,
            message: 'Scan the QR code to connect'
          });
        } catch (qrError) {
          console.error('QR generation error:', qrError);
          res.status(500).json({ 
            status: 'ERROR',
            message: 'Failed to generate QR code'
          });
          cleanup();
        }
      }

      if (connection === 'open') {
        cleanup();
        // Connection established, you can add your logic here
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection timeout (30 seconds)
    connectionTimeout = setTimeout(() => {
      if (!qrGenerated) {
        res.status(408).json({
          status: 'TIMEOUT',
          message: 'QR generation timed out'
        });
        cleanup();
      }
    }, 30000);

    // Handle client disconnect
    req.on('close', cleanup);

  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Internal server error'
    });
  }
});

// Endpoint to check session status
router.get('/session-status', async (req, res) => {
  try {
    const credsPath = path.join(__dirname, 'SESSION', 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
      return res.json({ 
        status: 'NO_SESSION',
        connected: false
      });
    }

    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    res.json({
      status: 'SESSION_EXISTS',
      connected: true,
      sessionId: creds.me.id
    });
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to check session'
    });
  }
});

module.exports = router;
