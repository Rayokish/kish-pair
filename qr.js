const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');
const { makeid } = require('./gen-id');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');

// Session management
const sessionFolder = path.join(__dirname, 'SESSION');
if (!fs.existsSync(sessionFolder)) {
  fs.mkdirSync(sessionFolder, { recursive: true });
}

router.get('/', async (req, res) => {
  const sessionId = makeid();
  const sessionPath = path.join(sessionFolder, sessionId);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      printQRInTerminal: true, // Shows QR in terminal for debugging
      logger: pino({ level: 'fatal' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      // Generate and send QR code
      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrImage = await QRCode.toDataURL(qr);
          res.json({
            status: 'success',
            qr: qrImage,
            sessionId: sessionId
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

      // Handle successful connection
      if (connection === 'open') {
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const credsData = fs.readFileSync(credsPath, 'utf8');
          await sock.sendMessage(sock.user.id, {
            text: `Your session credentials:\n\n${credsData}\n\nKeep this safe!`
          });
          
          // Send as file attachment
          await sock.sendMessage(sock.user.id, {
            document: fs.readFileSync(credsPath),
            fileName: 'creds.json',
            mimetype: 'application/json'
          });
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
