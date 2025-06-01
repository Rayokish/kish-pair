const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { toBuffer } = require('qrcode');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');

const sessionFolder = path.join(__dirname, 'SESSION');

router.get('/', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr && !qrSent) {
        qrSent = true;
        try {
          // Generate QR as PNG buffer
          const qrBuffer = await toBuffer(qr);
          
          // Set proper image headers
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrBuffer.length
          });
          res.end(qrBuffer);
          
          // Log to terminal (optional)
          console.log('QR code generated successfully');
        } catch (error) {
          console.error('QR generation failed:', error);
          res.status(500).send('Failed to generate QR');
          sock.ws.close();
        }
      }

      if (connection === 'open') {
        const credsPath = path.join(sessionFolder, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const credsData = fs.readFileSync(credsPath, 'utf8');
          await sock.sendMessage(sock.user.id, {
            text: `✅ Session Connected!\n\nYour credentials:\n${credsData}`
          });
        }
        sock.ws.close();
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR generation timed out');
        sock.ws.close();
      }
    }, 30000);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;
