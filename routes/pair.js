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
                await delay(1500); // Increased delay
                const code = await sock.requestPairingCode(num);
                console.log('Pairing code generated:', code); // Debug log
                if (!res.headersSent) res.send({ code });
            }

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                console.log('Connection update:', connection); // Debug log
                
                if (connection === "open") {
                    console.log('Connection opened, preparing to send files'); // Debug log
                    await delay(5000); // Increased delay to ensure proper connection
                    
                    try {
                        const credsPath = path.join(sessionFolder, 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Creds file not found");
                        }

                        // 1. First send security warning
                        await sock.sendMessage(sock.user.id, { 
                            text: "🚀 Connection established! Preparing your files..." 
                        });

                        // 2. Send credentials
                        const sessionXeon = fs.readFileSync(credsPath);
                        const xeonses = await sock.sendMessage(sock.user.id, { 
                            document: sessionXeon, 
                            mimetype: 'application/json', 
                            fileName: 'creds.json',
                            caption: "⚠️ SECURITY WARNING ⚠️\nDo not share this file with anyone!"
                        });

                        // 3. Try to join group (with error handling)
                        try {
                            await sock.groupAcceptInvite("LhBwWwQAS4y93XOsCKpxdv");
                            await sock.sendMessage(sock.user.id, {
                                text: "✅ Successfully joined the group!"
                            });
                        } catch (groupError) {
                            console.error("Group join error:", groupError);
                            await sock.sendMessage(sock.user.id, {
                                text: "⚠️ Could not join group: " + groupError.message
                            });
                        }

                        // 4. Send MP3 (with error handling)
                        try {
                            const mp3Path = path.join(__dirname, 'OneDance.mp3');
                            if (fs.existsSync(mp3Path)) {
                                const audioxeon = fs.readFileSync(mp3Path);
                                await sock.sendMessage(sock.user.id, {
                                    audio: audioxeon,
                                    mimetype: 'audio/mp4',
                                    ptt: true
                                }, { quoted: xeonses });
                            } else {
                                await sock.sendMessage(sock.user.id, {
                                    text: "⚠️ MP3 file not found"
                                });
                            }
                        } catch (mp3Error) {
                            console.error("MP3 send error:", mp3Error);
                        }

                        // 5. Final message
                        await sock.sendMessage(sock.user.id, {
                            text: "✅ All operations completed!"
                        });

                        await delay(1000);
                        sock.ws.close();
                        removeFile(sessionFolder);
                        process.exit(0);
                    } catch (e) {
                        console.error("Error in sending creds:", e);
                        await sock.sendMessage(sock.user.id, {
                            text: "❌ Error occurred: " + e.message
                        });
                        sock.ws.close();
                        removeFile(sessionFolder);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    console.log('Connection closed:', lastDisconnect?.error); // Debug log
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        await delay(10000); // Increased reconnect delay
                        XeonPair();
                    }
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
