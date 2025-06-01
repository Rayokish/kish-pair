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

// Universal session folder solution
function getSessionFolder() {
    if (process.env.VERCEL) return '/tmp/baileys_session';
    if (process.env.RENDER) return '/tmp/baileys_session';
    return path.join(__dirname, 'baileys_session');
}

const sessionFolder = getSessionFolder();

// Ensure session directory exists
if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number is required" });

    // Platform-specific response handling
    if (process.env.VERCEL) {
        // For Vercel, respond immediately and handle pairing in background
        res.send({ status: "processing", message: "Check /pairing-status for updates" });
    }

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
                // Optimized for both platforms
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 20000,
                markOnlineOnConnect: true
            });

            num = num.replace(/[^0-9]/g, '');
            
            if (!sock.authState.creds.registered) {
                await delay(1500);
                const code = await sock.requestPairingCode(num);
                console.log('Pairing code:', code);
                
                // Store code for both platforms
                fs.writeFileSync(path.join(sessionFolder, 'pairing_code.txt'), code);
                
                if (!process.env.VERCEL) {
                    // For Render, send code directly
                    res.send({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    console.log('Connection established');
                    await delay(3000);
                    
                    try {
                        const credsPath = path.join(sessionFolder, 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            console.log('Pairing successful');
                            fs.writeFileSync(path.join(sessionFolder, 'pairing_status.txt'), 'success');
                            
                            // Send credentials to user
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
                    } catch (e) {
                        console.error("Error:", e);
                        fs.writeFileSync(path.join(sessionFolder, 'pairing_status.txt'), 'failed');
                    } finally {
                        sock.ws.close();
                    }
                }

                if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log('Reconnecting...');
                    await delay(5000);
                    XeonPair();
                }
            });

        } catch (err) {
            console.error("Initialization error:", err);
            fs.writeFileSync(path.join(sessionFolder, 'pairing_status.txt'), 'error');
            if (sock?.ws) sock.ws.close();
        }
    }

    XeonPair();
});

// Status endpoint for both platforms
router.get('/pairing-status', async (req, res) => {
    try {
        const statusPath = path.join(sessionFolder, 'pairing_status.txt');
        const codePath = path.join(sessionFolder, 'pairing_code.txt');
        const credsPath = path.join(sessionFolder, 'creds.json');

        if (fs.existsSync(credsPath)) {
            return res.send({ status: "success" });
        }
        
        if (fs.existsSync(statusPath)) {
            const status = fs.readFileSync(statusPath, 'utf-8');
            if (status === 'error') return res.status(500).send({ error: "Pairing failed" });
        }
        
        if (fs.existsSync(codePath)) {
            const code = fs.readFileSync(codePath, 'utf-8');
            return res.send({ status: "pending", code });
        }
        
        return res.send({ status: "processing" });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

module.exports = router;
