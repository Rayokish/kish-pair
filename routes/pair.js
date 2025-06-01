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

// Platform-agnostic session path
const sessionFolder = path.join(
  process.env.VERCEL ? '/tmp' : 
  process.env.RENDER ? '/tmp' : 
  process.cwd(), 
  'baileys_session'  // Changed to more specific folder name
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

    // Store response object for later use
    let responseSent = false;
    const sendResponse = (data) => {
        if (!responseSent) {
            responseSent = true;
            res.send(data);
        }
    };

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
                // Added connection options for better reliability
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 15000
            });

            // Clean number input
            num = num.replace(/[^0-9]/g, '');
            
            if (!sock.authState.creds.registered) {
                await delay(1500);  // Increased delay for stability
                try {
                    const code = await sock.requestPairingCode(num);
                    console.log('Generated pairing code:', code);
                    sendResponse({ 
                        status: "success", 
                        code: code,
                        message: "Enter this code in WhatsApp to pair your device"
                    });
                    
                    // Store code in file for verification
                    fs.writeFileSync(path.join(sessionFolder, 'pairing_code.txt'), code);
                } catch (err) {
                    console.error('Error generating pairing code:', err);
                    sendResponse({ 
                        status: "error",
                        error: "Failed to generate pairing code",
                        details: err.message 
                    });
                    return;
                }
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log('QR code event received');
                }
                
                if (connection === "open") {
                    console.log('Connection established');
                    await delay(3000);
                    
                    try {
                        const credsPath = path.join(sessionFolder, 'creds.json');
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

                        console.log('Credentials sent successfully');
                        
                        // Cleanup
                        await delay(100);
                        sock.ws.close();
                        removeFile(sessionFolder);
                    } catch (e) {
                        console.error("Error in sending creds:", e);
                        sock.ws.close();
                        removeFile(sessionFolder);
                    }
                }

                if (connection === "close") {
                    console.log('Connection closed');
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        await delay(5000);
                        console.log('Attempting reconnect...');
                        XeonPair(); // Reconnect
                    }
                }
            });

        } catch (err) {
            console.error("Initialization error:", err);
            if (sock?.ws) sock.ws.close();
            removeFile(sessionFolder);
            if (!responseSent) {
                sendResponse({ 
                    status: "error",
                    error: "Initialization failed",
                    details: err.message 
                });
            }
        }
    }

    XeonPair();
});

module.exports = router;
