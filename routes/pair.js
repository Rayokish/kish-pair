const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const logger = pino({ level: 'silent' }).child({ level: 'silent' });

const sessionFolder = path.join(
  process.env.VERCEL || process.env.RENDER ? '/tmp' : process.cwd(), 
  'session'
);

// Ensure session directory exists
if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
}

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number is required" });

    // Set timeout headers
    res.setTimeout(30000, () => {
        if (!res.headersSent) {
            res.status(504).send({ error: "Request timeout" });
        }
    });

    async function XeonPair() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        let sock;

        try {
            sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger: logger,
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                // Add these options for better notification delivery
                getMessage: async () => ({}),
                shouldIgnoreJid: () => false,
                markOnlineOnConnect: true,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 25000
            });

            num = num.replace(/[^0-9]/g, '');
            
            if (!sock.authState.creds.registered) {
                await delay(1500);
                const code = await sock.requestPairingCode(num);
                console.log('Pairing code generated:', code);
                if (!res.headersSent) res.send({ code });
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log('QR code received');
                }

                if (connection === "open") {
                    console.log('Connection opened, sending notification...');
                    await delay(3000);
                    
                    try {
                        const credsPath = path.join(sessionFolder, 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Creds file not found");
                        }

                        const credsData = fs.readFileSync(credsPath);
                        
                        // Send notification with document
                        const sentMsg = await sock.sendMessage(sock.user.id, {
                            document: credsData,
                            fileName: `creds.json`,
                            mimetype: 'application/json',
                            caption: "Your session credentials"
                        });
                        console.log('Notification sent:', sentMsg);

                        // Send security warning
                        await sock.sendMessage(sock.user.id, { 
                            text: "⚠️ SECURITY WARNING ⚠️\nDo not share this file with anyone!" 
                        });

                        await delay(1000);
                        if (!res.headersSent) res.send({ status: "success", message: "Notification sent" });
                        
                        // Clean up
                        sock.ws.close();
                        removeFile(sessionFolder);
                        process.exit(0);
                    } catch (e) {
                        console.error("Error in sending notification:", e);
                        if (!res.headersSent) res.status(500).send({ error: "Failed to send notification" });
                        sock.ws.close();
                        removeFile(sessionFolder);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    console.log('Connection closed:', lastDisconnect?.error);
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        await delay(5000);
                        XeonPair();
                    }
                }
            });

            // Handle message delivery status
            sock.ev.on('messages.upsert', ({ messages }) => {
                console.log('Message upsert:', messages);
            });

        } catch (err) {
            console.error("Initialization error:", err);
            if (sock?.ws) sock.ws.close();
            removeFile(sessionFolder);
            if (!res.headersSent) res.status(500).send({ error: err.message });
        }
    }

    XeonPair();
});

module.exports = router;
