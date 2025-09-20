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

// Configure logger
const logger = pino({ level: 'silent' }).child({ level: 'silent' });

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number is required" });

    // Always clean number input
    num = num.replace(/[^0-9]/g, '');

    async function XeonPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
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
                syncFullHistory: false
            });

            // Always request a new pairing code
            await delay(1000);
            const code = await sock.requestPairingCode(num);
            if (!res.headersSent) res.send({ code });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    await delay(3000);
                    try {
                        const credsPath = path.join('./session', 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            const credsData = fs.readFileSync(credsPath);
                            await sock.sendMessage(sock.user.id, {
                                document: credsData,
                                fileName: `creds.json`,
                                mimetype: 'application/json'
                            });
                            await sock.sendMessage(sock.user.id, {
                                text: "⚠️ SECURITY WARNING ⚠️\nDo not share this file with anyone!"
                            });
                        }
                        // Cleanup
                        await delay(100);
                        if (sock.ws) sock.ws.close();
                        removeFile('./session');
                    } catch (e) {
                        console.error("Error in sending creds:", e);
                        if (sock.ws) sock.ws.close();
                        removeFile('./session');
                    }
                }

                if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(5000);
                    XeonPair(); // Reconnect
                }
            });

        } catch (err) {
            console.error("Initialization error:", err);
            if (sock?.ws) sock.ws.close();
            removeFile('./session');
            if (!res.headersSent) res.status(500).send({ error: err.message });
        }
    }

    XeonPair();
});

module.exports = router;
