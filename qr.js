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

const sessionFolder = path.join(__dirname, 'SESSION');

// Ensure session directory exists
if (!fs.existsSync(sessionFolder)) {
  fs.mkdirSync(sessionFolder, { recursive: true });
}

router.get('/', async (req, res) => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const sock = makeWASocket({
      // Removed deprecated printQRInTerminal
      logger: pino({ level: 'silent' }), // Silent logger for cleaner output
      auth: state,
      browser: Browsers.macOS('Safari'),
    });

    let qrSent = false;
    let connectionTimeout;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      // Handle QR Code Generation
      if (qr && !qrSent) {
        qrSent = true;
        clearTimeout(connectionTimeout);
        
        try {
          // Generate QR as data URL for web display
          const qrImage = await QRCode.toDataURL(qr);
          
          // Also log QR to console (alternative to printQRInTerminal)
          console.log('Scan this QR code to connect:');
          console.log(qr); // This shows the raw QR code in terminal
          
          res.json({
            status: 'success',
            qr: qrImage,
            message: 'Scan the QR code to connect'
          });
        } catch (error) {
          console.error('QR generation failed:', error);
          res.status(500).json({ error: 'Failed to generate QR code' });
          sock.ws.close();
        }
      }

      // Handle Successful Connection
      if (connection === 'open') {
        const credsPath = path.join(sessionFolder, 'creds.json');
        
        if (fs.existsSync(credsPath)) {
          try {
            const credsData = fs.readFileSync(credsPath, 'utf8');
            const sessionInfo = JSON.parse(credsData);
            
            // Send credentials to user
            await sock.sendMessage(sock.user.id, {
              text: `✅ Session Connected!\n\nUser ID: ${sessionInfo.me.id}\n\nKeep this information secure.`
            });

            // Send creds.json as file attachment
            await sock.sendMessage(sock.user.id, {
              document: fs.readFileSync(credsPath),
              fileName: 'whatsapp_session.json',
              mimetype: 'application/json'
            });
          } catch (e) {
            console.error('Failed to send session info:', e);
          }
        }
        
        sock.ws.close();
      }

      // Handle Connection Errors
      if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log('Connection closed, attempting reconnect...');
        setTimeout(() => initializeWhatsApp(), 5000);
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection Timeout (30 seconds)
    connectionTimeout = setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(408).json({ error: 'QR generation timed out' });
        sock.ws.close();
      }
    }, 30000);

    // Handle client disconnect
    req.on('close', () => {
      if (!qrSent) sock.ws.close();
    });

  } catch (error) {
    console.error('Initialization error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
