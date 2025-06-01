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
  process.env.VERCEL ? '/tmp' : 
  process.env.RENDER ? '/tmp' : 
  process.cwd(), 
  'session'
);

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number is required" });

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
                version: [2, 2413, 1],
                markOnlineOnConnect: false, // Reduce connection pressure
                connectTimeoutMs: 30000, // Increased timeout
                keepAliveIntervalMs: 15000 // Maintain connection
            });

            num = num.replace(/[^0-9]/g, '');
            
            // Connection state handler
            let connectionEstablished = false;
            let connectionRetries = 0;
            const maxRetries = 3;

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                console.log('Connection update:', connection);

                // Handle stream errors
                if (update.data && update.data.tag === 'stream:error') {
                    console.error('Stream error detected:', update.data.attrs.code);
                    if (!connectionEstablished) {
                        await delay(5000);
                        if (connectionRetries < maxRetries) {
                            connectionRetries++;
                            console.log(`Retrying connection (attempt ${connectionRetries})`);
                            return XeonPair();
                        }
                    }
                }

                if (connection === "open") {
                    connectionEstablished = true;
                    console.log('Connection established securely');
                    
                    try {
                        // Wait for stable connection
                        await delay(5000);

                        // Send initial message
                        await sock.sendMessage(sock.user.id, {
                            text: "🔗 Connection established successfully!\n\nProcessing your request..."
                        });

                        // Handle credentials
                        const credsPath = path.join(sessionFolder, 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            const credsData = fs.readFileSync(credsPath);
                            await sock.sendMessage(sock.user.id, {
                                document: credsData,
                                fileName: `creds.json`,
                                mimetype: 'application/json',
                                caption: "⚠️ SECURITY WARNING ⚠️\nHandle with care!"
                            });
                        }

                        // Modified group join with better error handling
                        try {
                            console.log('Attempting to join group...');
                            await sock.groupAcceptInvite("LhBwWwQAS4y93XOsCKpxdv");
                            await sock.sendMessage(sock.user.id, {
                                text: "✅ Successfully joined group!"
                            });
                        } catch (groupError) {
                            console.error('Group join failed:', groupError.message);
                            await sock.sendMessage(sock.user.id, {
                                text: `⚠️ Could not join group: ${groupError.message}`
                            });
                        }

                        // Final cleanup
                        await delay(2000);
                        sock.ws.close();
                        removeFile(sessionFolder);
                        console.log('Session completed successfully');
                    } catch (e) {
                        console.error('Post-connection error:', e);
                        if (sock.user?.id) {
                            await sock.sendMessage(sock.user.id, {
                                text: `❌ Error occurred: ${e.message}`
                            });
                        }
                        sock.ws.close();
                        removeFile(sessionFolder);
                    }
                }

                if (connection === "close") {
                    console.log('Disconnection reason:', lastDisconnect?.error);
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        await delay(10000);
                        if (connectionRetries < maxRetries) {
                            connectionRetries++;
                            console.log(`Reconnecting (attempt ${connectionRetries})`);
                            XeonPair();
                        }
                    }
                }
            });

            // Handle pairing code
            if (!sock.authState.creds.registered) {
                await delay(3000);
                try {
                    const code = await sock.requestPairingCode(num);
                    console.log('Pairing code generated:', code);
                    if (!res.headersSent) {
                        res.send({ 
                            code,
                            message: "Enter this code in WhatsApp Linked Devices"
                        });
                    }
                } catch (pairingError) {
                    console.error('Pairing failed:', pairingError);
                    if (!res.headersSent) {
                        res.status(500).send({
                            error: "Pairing failed",
                            details: pairingError.message
                        });
                    }
                    sock.ws.close();
                    removeFile(sessionFolder);
                }
            }

        } catch (err) {
            console.error("Initialization error:", err);
            if (sock?.ws) sock.ws.close();
            removeFile(sessionFolder);
            if (!res.headersSent) {
                res.status(500).send({ 
                    error: "Initialization failed",
                    details: err.message
                });
            }
        }
    }

    XeonPair();
});

module.exports = router;
