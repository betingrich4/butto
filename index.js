import { Boom } from '@hapi/boom'
import Baileys, {
  DisconnectReason,
  delay,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import PastebinAPI from 'pastebin-js'
import path, { dirname } from 'path'
import pino from 'pino'
import { fileURLToPath } from 'url'
import moment from 'moment-timezone'

const app = express()
let pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL')

// Enhanced Configuration
const config = {
  TIME_ZONE: 'Africa/Nairobi',
  AUTO_STATUS_REACT: true,
  STATUS_REACT_EMOJIS: ['❤️', '💸', '😇', '🍂', '💥'],
  BIO_UPDATE_INTERVAL: 60000, // 1 minute
  SESSION_PREFIX: 'JOEL~XMD~'
}

// Middleware Improvements
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 8000
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Session Management Enhancements
function createRandomId() {
  return Array.from({length: 10}, () => 
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)
    ]).join('')
}

let sessionFolder = `./auth/${createRandomId()}`

const clearState = () => {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true })
  }
}

// Bio Updater
async function updateBio(sock) {
  try {
    const now = moment().tz(config.TIME_ZONE)
    const newBio = `⏰ ${now.format('HH:mm')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Joel-XMD`
    await sock.updateProfileStatus(newBio)
    console.log(`Bio updated: ${newBio}`)
  } catch (error) {
    console.error('Bio update error:', error)
  }
}

// Status Auto-View and React
async function handleStatusView(sock) {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast')
    if (statusMsg && config.AUTO_STATUS_REACT) {
      try {
        await sock.readMessages([statusMsg.key])
        const randomEmoji = config.STATUS_REACT_EMOJIS[
          Math.floor(Math.random() * config.STATUS_REACT_EMOJIS.length)
        ]
        await sock.sendMessage(statusMsg.key.remoteJid, {
          react: { 
            text: randomEmoji, 
            key: statusMsg.key 
          }
        })
        console.log(`Reacted to status with ${randomEmoji}`)
      } catch (error) {
        console.error('Status react error:', error)
      }
    }
  })
}

// Routes
app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.get('/pair', async (req, res) => {
  let phone = req.query.phone

  if (!phone) return res.json({ error: 'Please Provide Phone Number' })

  try {
    const code = await startSession(phone)
    res.json({ code })
  } catch (error) {
    console.error('Error in WhatsApp authentication:', error)
    res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
})

// Enhanced Session Starter
async function startSession(phone) {
  return new Promise(async (resolve, reject) => {
    try {
      clearState()
      
      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true })
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)

      const sock = Baileys.makeWASocket({
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: state,
      })

      if (!sock.authState.creds.registered) {
        const phoneNumber = phone.replace(/[^0-9]/g, '')
        if (phoneNumber.length < 11) {
          return reject(new Error('Please Enter Your Number With Country Code !!'))
        }

        const code = await sock.requestPairingCode(phoneNumber)
        console.log(`Joel-XMD Pairing Code: ${code}`)
        resolve(code)
      }

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
          // Start bot features
          await updateBio(sock)
          const bioInterval = setInterval(() => updateBio(sock), config.BIO_UPDATE_INTERVAL)
          await handleStatusView(sock)

          // Session backup to Pastebin
          try {
            const output = await pastebin.createPasteFromFile(
              `${sessionFolder}/creds.json`,
              'Joel-XMD Session',
              null,
              1,
              'N'
            )
            const sessionId = config.SESSION_PREFIX + output.split('https://pastebin.com/')[1]
            console.log(sessionId)
            
            await sock.sendMessage(sock.user.id, { 
              text: `*╭──────────────━┈⊷*\n*║ᴊᴏᴇʟ-xᴍᴅ-ᴠ¹⁰ sᴇssɪᴏɴ ɪᴅ*\n*╰───────────────━⊷*\n\n` +
                    `Session ID: ${sessionId}\n\n` +
                    `*╭─────────────━┈⊷*\n║ᴏᴡɴᴇʀ: ʟᴏʀᴅ ᴊᴏᴇʟ\n*╰─────────────━┈⊷*\n\n` +
                    `*ᴛʜᴀɴᴋs ғᴏʀ ᴄʜᴏᴏsɪɴɢ ᴊᴏᴇʟ-ᴍᴅ*`
            })

            console.log('Connected to WhatsApp Servers')
          } catch (error) {
            console.error('Pastebin upload error:', error)
          }
        }

        if (connection === 'close') {
          const reason = new Boom(lastDisconnect?.error)?.output.statusCode
          const errorMessages = {
            [DisconnectReason.connectionClosed]: 'Connection closed, reconnecting...',
            [DisconnectReason.connectionLost]: 'Connection lost, reconnecting...',
            [DisconnectReason.loggedOut]: 'Device logged out, please relink',
            [DisconnectReason.restartRequired]: 'Server restarting...',
            [DisconnectReason.timedOut]: 'Connection timeout, reconnecting...',
            [DisconnectReason.badSession]: 'Bad session, reconnecting...',
            [DisconnectReason.connectionReplaced]: 'Connection replaced, reconnecting...'
          }

          console.log(errorMessages[reason] || 'Server disconnected unexpectedly')
          
          if (reason !== DisconnectReason.loggedOut) {
            setTimeout(() => startSession(phone), 5000)
          }
        }
      })

      sock.ev.on('messages.upsert', () => {})

    } catch (error) {
      console.error('Session error:', error)
      reject(error)
    }
  })
}

app.listen(PORT, () => {
  console.log(`Joel-XMD API Running on PORT:${PORT}`)
})
