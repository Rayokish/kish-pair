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

    let responseSent = false;
    let sock = null;

    async function XeonPair() {
        // Clean session at start for fresh pairing
        removeFile('./session');
        
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        
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

            // Clean number input
            num = num.replace(/[^0-9]/g, '');
            
            // Request pairing code if not registered
            if (!state.creds.registered) {
                await delay(1500);
                try {
                    const code = await sock.requestPairingCode(num);
                    console.log(`Pairing code generated: ${code}`);
                    if (!responseSent) {
                        responseSent = true;
                        res.send({ 
                            code: code,
                            message: "Use this code to pair your device"
                        });
                    }
                } catch (pairError) {
                    console.error("Pairing code error:", pairError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ error: "Failed to generate pairing code: " + pairError.message });
                    }
                    return;
                }
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                console.log("Connection update:", connection);
                
                if (connection === "open") {
                    console.log("✅ Connected to WhatsApp!");
                    
                    try {
                        // Wait a bit for connection to stabilize
                        await delay(3000);
                        
                        const credsPath = path.join('./session', 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Creds file not found");
                        }

                        const credsData = fs.readFileSync(credsPath);
                        const userJid = sock.user?.id;
                        
                        if (!userJid) {
                            throw new Error("User JID not available");
                        }

                        console.log("Sending credentials file...");
                        
                        // Send credentials file
                        await sock.sendMessage(userJid, {
                            document: credsData,
                            fileName: `creds.json`,
                            mimetype: 'application/json'
                        });

                        console.log("Credentials file sent successfully!");
                        
                        // Send security warning
                        await sock.sendMessage(userJid, { 
                            text: "⚠️ *SECURITY WARNING* ⚠️\n\nThis file contains your WhatsApp session credentials.\n\n*DO NOT SHARE THIS FILE WITH ANYONE!*\n\nKeep it secure and never expose it publicly." 
                        });

                        console.log("Security warning sent!");
                        
                        // Send success confirmation
                        await sock.sendMessage(userJid, { 
                            text: "✅ Session credentials have been successfully delivered to your WhatsApp!"
                        });

                        console.log("Success confirmation sent!");
                        
                        // Wait a moment before cleanup to ensure messages are delivered
                        await delay(2000);
                        
                        // Cleanup - close connection and remove session
                        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
                            sock.ws.close();
                        }
                        removeFile('./session');
                        
                        console.log("Cleanup completed successfully!");
                        
                    } catch (sendError) {
                        console.error("❌ Error in sending creds:", sendError);
                        
                        try {
                            const userJid = sock.user?.id;
                            if (userJid) {
                                await sock.sendMessage(userJid, { 
                                    text: `❌ Error sending credentials: ${sendError.message}` 
                                });
                            }
                        } catch (notificationError) {
                            console.error("Failed to send error notification:", notificationError);
                        }
                        
                        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
                            sock.ws.close();
                        }
                        removeFile('./session');
                    }
                }

                if (connection === "close") {
                    console.log("Connection closed");
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                    
                    if (shouldReconnect && !responseSent) {
                        console.log("Attempting to reconnect...");
                        await delay(5000);
                        XeonPair();
                    } else if (lastDisconnect?.error) {
                        console.error("Disconnection error:", lastDisconnect.error);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ error: "Connection failed: " + lastDisconnect.error.message });
                        }
                    }
                }
            });

            // Handle message delivery updates
            sock.ev.on('messages.upsert', async (messageData) => {
                const message = messageData.messages[0];
                if (message && message.key.fromMe) {
                    console.log("Message delivered:", message.key.id);
                }
            });

        } catch (err) {
            console.error("❌ Initialization error:", err);
            if (sock?.ws && sock.ws.readyState === sock.ws.OPEN) {
                sock.ws.close();
            }
            removeFile('./session');
            if (!responseSent) {
                responseSent = true;
                res.status(500).send({ error: "Initialization failed: " + err.message });
            }
        }
    }

    // Set timeout for the entire operation
    const timeout = setTimeout(() => {
        if (!responseSent) {
            responseSent = true;
            res.status(408).send({ error: "Request timeout - please try again" });
            if (sock?.ws && sock.ws.readyState === sock.ws.OPEN) {
                sock.ws.close();
            }
            removeFile('./session');
        }
    }, 120000); // 2 minute timeout

    // Clear timeout if response is sent
    res.on('finish', () => {
        clearTimeout(timeout);
    });

    XeonPair();
});

module.exports = router;
