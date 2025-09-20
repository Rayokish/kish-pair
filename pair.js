const const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
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

    // Clean number input
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
                browser: Browsers.macOS("Chrome"), // Changed to valid browser
                syncFullHistory: false,
                markOnlineOnConnect: false // To receive notifications on phone
            });

            let pairingCodeRequested = false;
            
            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                // Request pairing code at right time
                if ((connection === "connecting" || qr) && !sock.authState.creds.registered && !pairingCodeRequested) {
                    pairingCodeRequested = true;
                    await delay(1000);
                    
                    try {
                        const code = await sock.requestPairingCode(num);
                        if (!res.headersSent) res.send({ code });
                    } catch (pairingError) {
                        console.error("Pairing code error:", pairingError);
                        if (!res.headersSent) res.status(500).send({ error: pairingError.message });
                        removeFile('./session');
                    }
                }
                
                if (connection === "open") {
                    console.log("Connected successfully!");
                    
                    await delay(3000);
                    
                    try {
                        const credsPath = path.join('./session', 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Creds file not found");
                        }

                        const credsData = fs.readFileSync(credsPath);
                        await sock.sendMessage(sock.user.id, {
                            document: credsData,
                            fileName: `creds.json`,
                            mimetype: 'application/json'
                        });

                        await sock.sendMessage(sock.user.id, { 
                            text: "⚠️ SECURITY WARNING ⚠️\nDo not share this file with anyone!" 
                        });

                        // Cleanup
                        await delay(100);
                        sock.ws.close();
                        removeFile('./session');
                    } catch (e) {
                        console.error("Error in sending creds:", e);
                        sock.ws.close();
                        removeFile('./session');
                    }
                }

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log("Connection closed with status:", statusCode);
                    
                    if (statusCode !== DisconnectReason.loggedOut && statusCode !== 401) {
                        await delay(5000);
                        XeonPair(); // Reconnect
                    } else {
                        console.log("Connection closed permanently");
                        removeFile('./session');
                    }
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
