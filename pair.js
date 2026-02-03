const express = require('express')
const fs = require('fs')
const router = express.Router()
const pino = require('pino')

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys')

function removeFile(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

router.get('/', async (req, res) => {
  let num = req.query.number
  if (!num) return res.status(400).send({ error: 'Number required' })

  num = num.replace(/[^0-9]/g, '')

  let sock
  let replied = false

  async function XeonPair() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('./session')

      sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'fatal' }).child({ level: 'fatal' })
          )
        },
        logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Safari'),
        syncFullHistory: false
      })

      // 🔴 REQUIRED IN BAILEYS v7
      sock.ev.process(async (events) => {
        if (events['creds.update']) await saveCreds()
      })

      // ⏳ allow socket handshake to complete
      await delay(3000)

      // 🔐 request pairing code
      if (!state.creds.registered) {
        const code = await sock.requestPairingCode(num)
        if (!replied) {
          replied = true
          res.send({ code })
        }
      }

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
          console.log('✅ WhatsApp paired successfully')

          // ⏳ DO NOT TOUCH SOCKET YET (WhatsApp trust finalization)
          await delay(15000)

          try {
            const sessionFile = './session/creds.json'
            const audioFile = './OneDance.mp3'

            if (fs.existsSync(sessionFile)) {
              const sessionData = fs.readFileSync(sessionFile)

              const sent = await sock.sendMessage(sock.user.id, {
                document: sessionData,
                mimetype: 'application/json',
                fileName: 'creds.json'
              })

              if (fs.existsSync(audioFile)) {
                await sock.sendMessage(
                  sock.user.id,
                  {
                    audio: fs.readFileSync(audioFile),
                    mimetype: 'audio/mp4',
                    ptt: true
                  },
                  { quoted: sent }
                )
              }

              await sock.sendMessage(
                sock.user.id,
                {
                  text:
                    '*_🛑 Do not share this file with anybody_*\n\n' +
                    '© *_Subscribe_* www.youtube.com/@Brashokish *_on Youtube_*'
                },
                { quoted: sent }
              )
            }

            // optional group join
            await sock.groupAcceptInvite('LhBwWwQAS4y93XOsCKpxdv')
          } catch (e) {
            console.error('Post-pair error:', e)
          }

          // ⏳ graceful shutdown AFTER everything
          await delay(5000)

          try {
            if (sock?.ws?.readyState === sock.ws.OPEN) sock.ws.close()
          } catch {}

          removeFile('./session')
        }

        if (
          connection === 'close' &&
          lastDisconnect?.error?.output?.statusCode !== 401
        ) {
          console.log('🔄 Reconnecting...')
          await delay(5000)
          XeonPair()
        }
      })
    } catch (err) {
      console.error('❌ Pairing failed:', err)
      removeFile('./session')

      if (!replied) {
        replied = true
        res.send({ code: 'Service Unavailable' })
      }
    }
  }

  XeonPair()
})

process.on('uncaughtException', (err) => {
  const e = String(err)
  if (
    e.includes('conflict') ||
    e.includes('Socket connection timeout') ||
    e.includes('not-authorized') ||
    e.includes('rate-overlimit') ||
    e.includes('Connection Closed') ||
    e.includes('Timed Out') ||
    e.includes('Value not found')
  ) {
    return
  }
  console.log('Caught exception:', err)
})

module.exports = router
