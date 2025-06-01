const express = require('express');
const { toBuffer } = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const { delay, useMultiFileAuthState, makeInMemoryStore, default: makeWASocket } = require('@whiskeysockets/baileys');

const router = express.Router();

// Clean session folder
const sessionFolder = './SESSION';
if (fs.existsSync(sessionFolder)) {
  try {
    fs.rmdirSync(sessionFolder, { recursive: true });
    console.log('Deleted the "SESSION" folder.');
  } catch (err) {
    console.error('Error deleting the "SESSION" folder:', err);
  }
}

router.get('/', async (req, res) => {
  async function Guru() {
    const { state, saveCreds } = await useMultiFileAuthState('./SESSION');
    try {
      let conn = makeWASocket({
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        auth: state,
        browser: [`𝐁𝐫𝐚𝐬𝐡𝐨 𝐊𝐢𝐬𝐡`, "Safari", "3.0"],
      });

      conn.ev.on('connection.update', async (s) => {
        console.log(s);
        if (s.qr !== undefined) {
          res.end(await toBuffer(s.qr));
        }

        if (s.connection === 'open') {
          await delay(5000);
          let botsession = fs.readFileSync('./SESSION/creds.json');
          await delay(10000);
          await conn.sendMessage(conn.user.id, {
            document: botsession,
            mimetype: `application/json`,
            fileName: `creds.json`
          });

          let message = `Hi, you're successfully connected!\n\nHere is your session file.\n\nHave a great day ahead!`;
          await conn.sendMessage(conn.user.id, {
            image: { url: 'https://telegra.ph/file/9ae2ef1de51e0683cb506.jpg' },
            caption: message,
          });

          process.send?.('reset');
        }

        if (s.connection === 'close' && s.lastDisconnect?.error?.output?.statusCode !== 401) {
          await Guru(); // reconnect
        }
      });

      conn.ev.on('creds.update', saveCreds);
      conn.ev.on('messages.upsert', () => {});
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).send('QR generation failed');
      }
    }
  }

  Guru();
});

module.exports = router;
