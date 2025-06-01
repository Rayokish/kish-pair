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

// Clear session on startup
const sessionFolder = path.join(__dirname, 'SESSION');
if (fs.existsSync(sessionFolder)) {
  fs.rmSync(sessionFolder, { recursive: true, force: true });
}

router.get('/qr-api', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./SESSION');

    const sock = makeWASocket({
      printQRInTerminal: true, // For debugging
      logger: pino({ level: 'fatal' }),
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      // Send QR code
      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrImageBuffer = await toBuffer(qr);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': qrImageBuffer.length,
          });
          res.end(qrImageBuffer);
        } catch (error) {
          console.error('QR generation failed:', error);
          if (!res.headersSent) {
            res.status(500).send('QR generation failed');
          }
          sock.ws.close();
        }
      }

      // After successful connection
      if (connection === 'open') {
        const credsPath = path.join(__dirname, 'SESSION', 'creds.json');
        
        if (fs.existsSync(credsPath)) {
          try {
            // Read the credentials file
            const credsData = fs.readFileSync(credsPath, 'utf8');
            const sessionInfo = JSON.parse(credsData);
            
            // Send to the user who scanned
            await sock.sendMessage(sock.user.id, { 
              text: `Here is your session credentials:\n\n${credsData}\n\nKeep this safe!`
            });
            
            // Optional: Send as a file attachment
            await sock.sendMessage(sock.user.id, {
              document: fs.readFileSync(credsPath),
              fileName: 'creds.json',
              mimetype: 'application/json'
            });
            
            console.log('Session credentials sent to:', sock.user.id);
          } catch (sendError) {
            console.error('Failed to send credentials:', sendError);
            await sock.sendMessage(sock.user.id, { 
              text: 'Failed to send session credentials. Please try again.'
            });
          }
        }
        
        // Close connection
        sock.ws.close();
      }

      // Handle connection errors
      if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
        sock.end();
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout handling
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).send('QR code generation timeout');
        sock.ws.close();
      }
    }, 30000);

  } catch (error) {
    console.error('Error in /qr-api:', error);
    if (!res.headersSent) {
      res.status(500).send({ error: error.message });
    }
  }
});

module.exports = router;
