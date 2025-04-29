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

const app = express()
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL')

// Middleware
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})
app.use(cors())

const PORT = process.env.PORT || 8000
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Session Management
function createRandomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 10; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

let sessionFolder = `./auth/${createRandomId()}`

const clearState = () => {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true })
  }
}

// Status Viewing Functionality
function setupStatusViewing(sock) {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast')
    if (statusMsg) {
      try {
        // Automatically view status
        await sock.readMessages([statusMsg.key])
        console.log('Viewed status update')
      } catch (error) {
        console.error('Error viewing status:', error)
      }
    }
  })
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.get('/pair', async (req, res) => {
  const phone = req.query.phone?.replace(/[^0-9]/g, '')
  
  if (!phone || phone.length < 11) {
    return res.status(400).json({ error: 'Please provide valid phone number with country code' })
  }

  try {
    const code = await startSession(phone)
    res.json({ code })
  } catch (error) {
    console.error('Authentication error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Session Starter
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
        const code = await sock.requestPairingCode(phone)
        console.log(`Pairing Code: ${code}`)
        resolve(code)
      }

      sock.ev.on('creds.update', saveCreds)
      setupStatusViewing(sock) // Add status viewing

      sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
          // Session backup to Pastebin
          try {
            const output = await pastebin.createPasteFromFile(
              `${sessionFolder}/creds.json`,
              'Joel-XMD Session',
              null,
              1,
              'N'
            )
            const sessionId = 'JOEL~XMD~' + output.split('pastebin.com/')[1]
            console.log(sessionId)
            
            await sock.sendMessage(sock.user.id, { 
              text: `*╭──────────────━┈⊷*\n*║ᴊᴏᴇʟ-xᴍᴅ-ᴠ¹⁰ sᴇssɪᴏɴ ɪᴅ*\n*╰───────────────━⊷*\n\n` +
                    `Session ID: ${sessionId}\n\n` +
                    `*╭─────────────━┈⊷*\n║ᴏᴡɴᴇʀ: ʟᴏʀᴅ ᴊᴏᴇʟ\n*╰─────────────━┈⊷*\n\n` +
                    `*ᴛʜᴀɴᴋs ғᴏʀ ᴄʜᴏᴏsɪɴɢ ᴊᴏᴇʟ-ᴍᴅ*`
            })

            console.log('Connected to WhatsApp')
          } catch (error) {
            console.error('Pastebin error:', error)
          }
        }

        if (connection === 'close') {
          const reason = new Boom(lastDisconnect?.error)?.output.statusCode
          console.log(`Disconnected (${reason}), reconnecting...`)
          setTimeout(() => startSession(phone), 5000)
        }
      })

    } catch (error) {
      console.error('Session error:', error)
      reject(error)
    }
  })
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
