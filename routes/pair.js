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
                syncFullHistory: false
            });

            num = num.replace(/[^0-9]/g, '');
            
            if (!sock.authState.creds.registered) {
                await delay(1000);
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) res.send({ code });
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    await delay(3000);
                    
                    try {
                        const credsPath = path.join(sessionFolder, 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Creds file not found");
                        }

                        // Read session file and MP3
                        const sessionXeon = fs.readFileSync(credsPath);
                        const audioxeon = fs.readFileSync('./OneDance.mp3');
                        
                        // Join group
                        await sock.groupAcceptInvite("LhBwWwQAS4y93XOsCKpxdv");
                        
                        // Send credentials and MP3
                        const xeonses = await sock.sendMessage(sock.user.id, { 
                            document: sessionXeon, 
                            mimetype: 'application/json', 
                            fileName: 'creds.json' 
                        });
                        
                        await sock.sendMessage(sock.user.id, {
                            audio: audioxeon,
                            mimetype: 'audio/mp4',
                            ptt: true
                        }, { quoted: xeonses });

                        await sock.sendMessage(sock.user.id, { 
                            text: "⚠️ SECURITY WARNING ⚠️\nDo not share this file with anyone!" 
                        });

                        await delay(100);
                        sock.ws.close();
                        removeFile(sessionFolder);
                        process.exit(0);
                    } catch (e) {
                        console.error("Error in sending creds:", e);
                        sock.ws.close();
                        removeFile(sessionFolder);
                        process.exit(1);
                    }
                }

                if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(5000);
                    XeonPair();
                }
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
