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

// Session folder path
const sessionFolder = path.join(__dirname, 'SESSION');

// Ensure SESSION directory exists
if (!fs.existsSync(sessionFolder)) {
  fs.mkdirSync(sessionFolder, { recursive: true });
}

router.get('/', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      printQRInTerminal: true, // Helps debugging
      logger: pino({ level: 'fatal' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      // Send QR code
      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrImage = await QRCode.toDataURL(qr);
          res.json({
            status: 'success',
            qr: qrImage,
            message: 'Scan this QR code to connect'
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

      // On successful connection
      if (connection === 'open') {
        const credsPath = path.join(sessionFolder, 'creds.json');
        
        if (fs.existsSync(credsPath)) {
          try {
            const credsData = fs.readFileSync(credsPath, 'utf8');
            const sessionId = JSON.parse(credsData).me.id; // Extract WhatsApp ID from creds.json

            // Send session info to user
            await sock.sendMessage(sock.user.id, {
              text: `✅ Connected!\n\nYour Session ID:\n${sessionId}\n\nKeep this safe!`
            });

            // Optional: Send creds.json as a file
            await sock.sendMessage(sock.user.id, {
              document: fs.readFileSync(credsPath),
              fileName: 'creds.json',
              mimetype: 'application/json'
            });

          } catch (error) {
            console.error('Failed to send session info:', error);
          }
        }

        sock.ws.close(); // Disconnect after saving session
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout after 30 seconds if QR not generated
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
    console.error('Server error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
