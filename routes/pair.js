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

// Improved session folder handling with better Vercel compatibility
const sessionFolder = path.join(
  process.env.VERCEL ? '/tmp/session' : 
  process.env.RENDER ? '/tmp/session' : 
  path.join(process.cwd(), 'session')
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

    // Vercel-specific timeout handling (max 10s for hobby plan)
    const vercelTimeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(504).send({ error: "Pairing process timeout" });
        }
    }, 9500);

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
                // Additional settings for better Vercel compatibility
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 15000,
                markOnlineOnConnect: true
            });

            num = num.replace(/[^0-9]/g, '');
            
            if (!sock.authState.creds.registered) {
                await delay(1500); // Slightly longer delay for stability
                const code = await sock.requestPairingCode(num);
                console.log('Generated pairing code:', code);
                if (!res.headersSent) {
                    clearTimeout(vercelTimeout);
                    res.send({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, isNewLogin } = update;
                
                if (connection === "open") {
                    console.log('Connection established, sending credentials...');
                    await delay(3000);
                    
                    try {
                        const credsPath = path.join(sessionFolder, 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Creds file not found");
                        }

                        const credsData = fs.readFileSync(credsPath);
                        
                        // Send credentials
                        await sock.sendMessage(sock.user.id, {
                            document: credsData,
                            fileName: `creds.json`,
                            mimetype: 'application/json'
                        });

                        // Send security warning
                        await sock.sendMessage(sock.user.id, { 
                            text: "⚠️ SECURITY WARNING ⚠️\nDo not share this file with anyone!" 
                        });

                        console.log('Credentials sent successfully');
                        
                        // Clean up
                        await delay(500);
                        sock.ws.close();
                        removeFile(sessionFolder);
                        
                        if (!res.headersSent) {
                            clearTimeout(vercelTimeout);
                            res.send({ status: "success", message: "Paired successfully" });
                        }
                        
                        if (process.env.VERCEL) {
                            // Give Vercel time to send response before exiting
                            await delay(1000);
                        }
                        process.exit(0);
                    } catch (e) {
                        console.error("Error in sending creds:", e);
                        sock.ws.close();
                        removeFile(sessionFolder);
                        if (!res.headersSent) {
                            clearTimeout(vercelTimeout);
                            res.status(500).send({ error: "Failed to send credentials" });
                        }
                        process.exit(1);
                    }
                }

                if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log('Connection closed, attempting reconnect...');
                    await delay(5000);
                    XeonPair();
                }
            });

        } catch (err) {
            console.error("Initialization error:", err);
            if (sock?.ws) sock.ws.close();
            removeFile(sessionFolder);
            if (!res.headersSent) {
                clearTimeout(vercelTimeout);
                res.status(500).send({ error: err.message });
            }
        }
    }

    XeonPair();
});

module.exports = router;
