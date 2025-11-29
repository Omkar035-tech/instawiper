// videoWiper Discord Bot - Main Bot Script
// Install dependencies: npm install discord.js express multer dotenv

require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

// Express Server Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB limit (Discord's limit is 25MB for non-nitro)
    },
    fileFilter: (req, file, cb) => {
        // Supported formats
        const videoFormats = /\.(mp4|avi|mov|mkv|wmv|flv|webm|m4v|3gp)$/i;
        const imageFormats = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i;
        
        if (videoFormats.test(file.originalname) || imageFormats.test(file.originalname)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file format'));
        }
    }
});

// Store channel configurations
let channelConfig = {
    guildId: process.env.GUILD_ID || '',
    channelId: process.env.CHANNEL_ID || ''
};

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// API Routes
app.get('/api/guilds', async (req, res) => {
    try {
        const guilds = client.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL()
        }));
        console.log('Fetched guilds:', guilds);
        res.json(guilds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/channels/:guildId', async (req, res) => {
    try {
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Guild not found' });
        }

        const channels = guild.channels.cache
            .filter(channel => channel.isTextBased())
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                type: channel.type
            }));
        
        res.json(channels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config', (req, res) => {
    const { guildId, channelId } = req.body;
    channelConfig = { guildId, channelId };
    res.json({ success: true, config: channelConfig });
});

app.get('/api/config', (req, res) => {
    res.json(channelConfig);
});

app.post('/api/upload', upload.array('files', 10), async (req, res) => {
    try {
        if (!channelConfig.channelId) {
            return res.status(400).json({ error: 'Channel not configured' });
        }

        const channel = client.channels.cache.get(channelConfig.channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        const uploadedFiles = [];
        const { message } = req.body;

        for (const file of req.files) {
            const attachment = new AttachmentBuilder(file.path, { name: file.originalname });
            
            await channel.send({
                content: message || `📤 Uploaded by videoWiper`,
                files: [attachment]
            });

            uploadedFiles.push({
                name: file.originalname,
                size: file.size
            });

            // Delete file after upload
            fs.unlinkSync(file.path);
        }

        res.json({
            success: true,
            files: uploadedFiles,
            channel: channel.name
        });
    } catch (error) {
        // Clean up uploaded files on error
        if (req.files) {
            req.files.forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }
        res.status(500).json({ error: error.message });
    }
});

client.on('guildCreate', guild => {
    console.log(`✅ Bot joined server: ${guild.name} (${guild.id})`);
});

// Discord Bot Events
client.once('ready', () => {
    console.log('✅ videoWiper Bot is online!');
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`🌐 Web interface running on http://localhost:${PORT}`);

     // DEBUG: Show all servers
    console.log(`📊 Connected to ${client.guilds.cache.size} server(s):`);
    client.guilds.cache.forEach(guild => {
        console.log(`   - ${guild.name} (${guild.id})`);
    });
    
    client.user.setActivity('Managing uploads', { type: 3 });
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`🚀 videoWiper server started on port ${PORT}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down videoWiper...');
    client.destroy();
    process.exit(0);
});