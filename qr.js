const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');

// Session management
const sessionFolder = path.join(__dirname, 'SESSION');
if (fs.existsSync(sessionFolder)) {
  fs.rmSync(sessionFolder, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./SESSION');

    const sock = makeWASocket({
      printQRInTerminal: true, // Shows QR in terminal for debugging
      logger: pino({ level: 'fatal' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr && !qrSent) {
        qrSent = true;
        try {
          // Generate QR as data URL
          const qrImage = await QRCode.toDataURL(qr);
          
          res.json({
            status: 'success',
            qr: qrImage,
            message: 'Scan this QR code with your phone'
          });
          
        } catch (error) {
          console.error('QR generation failed:', error);
          res.status(500).json({ 
            status: 'error',
            message: 'Failed to generate QR code'
          });
          sock.ws.close();
        }
      }

      if (connection === 'open') {
        const credsPath = path.join(__dirname, 'SESSION', 'creds.json');
        if (fs.existsSync(credsPath)) {
          const credsData = fs.readFileSync(credsPath, 'utf8');
          console.log('Session established for:', JSON.parse(credsData).me.id);
        }
        sock.ws.close();
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout handling
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).json({ 
          status: 'error',
          message: 'QR generation timed out' 
        });
        sock.ws.close();
      }
    }, 30000);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
