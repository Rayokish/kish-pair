const express = require('express');
const router = express.Router();
const { default: makeWASocket, useSingleFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');

const logger = P({ level: 'silent' });

const authFile = './qr-session.json';
const { state, saveCreds } = useSingleFileAuthState(authFile);

let sock;

async function connectSocket() {
    if (sock) return sock;

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Safari'),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (connection === 'close') {
            sock = null;
            connectSocket();
        }
    });

    return sock;
}

router.get('/', async (req, res) => {
    try {
        const socket = await connectSocket();

        socket.ev.once('connection.update', async (update) => {
            if (update.qr) {
                const qrDataUrl = await QRCode.toDataURL(update.qr);
                if (!res.headersSent) {
                    res.json({ status: 'success', qr: qrDataUrl });
                }
            }
        });

        // Also try to send QR if already available in cache:
        if (socket.state && socket.state.qr) {
            const qrDataUrl = await QRCode.toDataURL(socket.state.qr);
            if (!res.headersSent) {
                res.json({ status: 'success', qr: qrDataUrl });
            }
        }
    } catch (error) {
        console.error('QR generation error:', error);
        if (!res.headersSent) res.status(500).json({ status: 'error', message: error.message });
    }
});

module.exports = router;
