// First, install the compatible chalk version by running:
// npm install chalk@4.1.2

const { Boom } = require('@hapi/boom');
const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const moment = require('moment-timezone');
const chalk = require('chalk');

// Configuration
const config = {
  TIME_ZONE: 'Africa/Nairobi',
  AUTO_STATUS_REACT: true,
  AUTO_REACT: true,
  STATUS_REACT_EMOJIS: ['❤️', '💸', '😇', '🍂', '💥'],
  BIO_UPDATE_INTERVAL: 60000,
  PREFIX: '!'
};

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Session Management
const getSessionFolder = () => {
  const folder = path.join(__dirname, 'auth', Math.random().toString(36).substring(2, 10));
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
};

const clearState = (folder) => {
  if (folder && fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
};

// Bio Updater
const updateBio = async (sock) => {
  try {
    const now = moment().tz(config.TIME_ZONE);
    const newBio = `⏰ ${now.format('HH:mm')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Marisel`;
    await sock.updateProfileStatus(newBio);
    console.log(chalk.blue(`✓ Bio updated`));
  } catch (error) {
    console.error(chalk.red('× Bio update error:'), error.message);
  }
};

// Bot Features
const setupBotFeatures = (sock) => {
  let bioInterval;
  
  sock.ev.on('connection.update', async (update) => {
    if (update.connection === 'open') {
      // Initial connection
      await updateBio(sock);
      bioInterval = setInterval(() => updateBio(sock), config.BIO_UPDATE_INTERVAL);
      
      await sock.sendMessage(sock.user.id, {
        text: `*Demon Slayer MiniBot Activated!*\n\n` +
              `• Auto-status viewing: ✅\n` +
              `• Auto-reactions: ✅\n` +
              `• Bio updates: Every minute\n\n` +
              `_Bot is now running automatically_`
      });
    }
    
    if (update.connection === 'close') {
      clearInterval(bioInterval);
    }
  });

  // Status Auto-View and React
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
      if (statusMsg && config.AUTO_STATUS_REACT) {
        await sock.readMessages([statusMsg.key]);
        const randomEmoji = config.STATUS_REACT_EMOJIS[
          Math.floor(Math.random() * config.STATUS_REACT_EMOJIS.length)
        ];
        await sock.sendMessage(statusMsg.key.remoteJid, {
          react: { 
            text: randomEmoji, 
            key: statusMsg.key 
          }
        });
      }
    } catch (error) {
      console.error(chalk.red('× Status react error:'), error.message);
    }
  });
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pair', async (req, res) => {
  try {
    const phone = req.query.phone?.replace(/[^0-9]/g, '');
    if (!phone || phone.length < 11) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    const sessionFolder = getSessionFolder();
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Chrome', 'Windows', '10.0.0']
    });

    sock.ev.on('creds.update', saveCreds);
    setupBotFeatures(sock);

    const code = await sock.requestPairingCode(phone);
    res.json({ code });
    
    // Cleanup after 5 minutes
    setTimeout(() => clearState(sessionFolder), 300000);
  } catch (error) {
    console.error(chalk.red('× Pairing error:'), error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(chalk.green(`✓ Server running on port ${PORT}`));
});

process.on('SIGTERM', () => process.exit());
