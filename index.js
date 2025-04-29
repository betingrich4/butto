import { Boom } from '@hapi/boom'
import Baileys, { DisconnectReason, delay, useMultiFileAuthState } from '@whiskeysockets/baileys'
import express from 'express'
import fs from 'fs'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import pino from 'pino'
import moment from 'moment-timezone'
import chalk from 'chalk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Configuration
const config = {
  TIME_ZONE: 'Africa/Nairobi',
  AUTO_STATUS_REACT: true,
  AUTO_REACT: true,
  STATUS_REACT_EMOJIS: ['❤️', '💸', '😇', '🍂', '💥'],
  BIO_UPDATE_INTERVAL: 60000, // 1 minute
  PREFIX: '!'
}

const app = express()
let PORT = process.env.PORT || 8000

// Session Management
let sessionFolder = `./auth/${Math.random().toString(36).substring(7)}`
const clearState = () => fs.existsSync(sessionFolder) && fs.rmSync(sessionFolder, { recursive: true })

// Bio Updater
const updateBio = async (sock) => {
  try {
    const now = moment().tz(config.TIME_ZONE)
    const newBio = `⏰ ${now.format('HH:mm')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Marisel`
    await sock.updateProfileStatus(newBio)
    console.log(chalk.blue(`Bio updated: ${newBio}`))
  } catch (error) {
    console.error(chalk.red('Bio update error:'), error)
  }
}

// Start Bot Functionality
const startBotFeatures = async (sock) => {
  // Start bio updater
  const bioInterval = setInterval(() => updateBio(sock), config.BIO_UPDATE_INTERVAL)
  
  // Status auto-view and react
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
        console.log(chalk.green(`Reacted to status with ${randomEmoji}`))
      } catch (error) {
        console.error(chalk.red('Status react error:'), error)
      }
    }
  })

  // Auto-reaction to messages
  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!config.AUTO_REACT) return
    const message = messages[0]
    if (!message.key.fromMe) {
      const randomEmoji = config.STATUS_REACT_EMOJIS[
        Math.floor(Math.random() * config.STATUS_REACT_EMOJIS.length)
      ]
      await sock.sendMessage(message.key.remoteJid, {
        react: { 
          text: randomEmoji, 
          key: message.key 
        }
      })
    }
  })

  // Connection cleanup
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close') {
      clearInterval(bioInterval)
    }
  })
}

// Pairing Code Endpoint
app.get('/pair', async (req, res) => {
  const phone = req.query.phone?.replace(/[^0-9]/g, '')
  if (!phone || phone.length < 11) {
    return res.json({ error: 'Invalid phone number' })
  }

  try {
    clearState()
    fs.mkdirSync(sessionFolder, { recursive: true })
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)
    const sock = Baileys.makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    })

    sock.ev.on('creds.update', saveCreds)
    
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000)
      
      sock.ev.on('connection.update', async (update) => {
        if (update.connection === 'open') {
          clearTimeout(timeout)
          
          // Send welcome message
          await sock.sendMessage(sock.user.id, {
            text: `*Demon Slayer MiniBot Activated!*\n\n` +
                  `• Auto-status viewing: ✅\n` +
                  `• Auto-reactions: ✅\n` +
                  `• Bio updates: Every minute\n\n` +
                  `_Bot will now run automatically_`
          })
          
          // Start bot features
          await startBotFeatures(sock)
          await updateBio(sock) // Initial bio update
          
          resolve('SUCCESS')
        }
      })

      sock.requestPairingCode(phone)
        .then(code => resolve(code))
        .catch(err => {
          clearTimeout(timeout)
          reject(err)
        })
    })

    res.json({ code: typeof code === 'string' ? code : 'SUCCESS' })
  } catch (error) {
    console.error(chalk.red('Pairing error:'), error)
    res.status(500).json({ error: error.message })
  } finally {
    setTimeout(clearState, 5000) // Cleanup after 5 sec
  }
})

app.listen(PORT, () => {
  console.log(chalk.yellow(`Server running on port ${PORT}`))
})
