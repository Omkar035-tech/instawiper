require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

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

// Instagram Reels Download API
app.post('/api/download-reel', async (req, res) => {
    try {
        const { url, message } = req.body;

        if (!channelConfig.channelId) {
            return res.status(400).json({ error: 'Channel not configured' });
        }

        if (!url) {
            return res.status(400).json({ error: 'Instagram URL is required' });
        }

        const channel = client.channels.cache.get(channelConfig.channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        // Extract Instagram shortcode from URL
        const shortcodeMatch = url.match(/(?:reel|p)\/([A-Za-z0-9_-]+)/);
        if (!shortcodeMatch) {
            return res.status(400).json({ error: 'Invalid Instagram URL' });
        }

        const shortcode = shortcodeMatch[1];

        // Fetch Instagram data using RapidAPI Instagram Reels Downloader
        const encodedUrl = encodeURIComponent(url);
        const apiUrl = `https://instagram-reels-downloader-api.p.rapidapi.com/download?url=${encodedUrl}`;
        
        const options = {
            method: 'GET',
            url: apiUrl,
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY || 'YOUR_RAPIDAPI_KEY',
                'x-rapidapi-host': 'instagram-reels-downloader-api.p.rapidapi.com'
            }
        };

        console.log('📥 Fetching Instagram Reel data...');
        const response = await axios.request(options);
        const data = response.data;

        console.log('Instagram API Response:', data);

        if (!data || !data.download_url) {
            return res.status(404).json({ 
                error: 'Could not fetch Instagram media',
                details: data
            });
        }

        // Download the video
        const videoUrl = data.download_url;
        console.log('📹 Downloading video from:', videoUrl);
        
        const videoResponse = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream'
        });

        // Save temporarily
        const filename = `reel_${shortcode}_${Date.now()}.mp4`;
        const filepath = path.join('./uploads', filename);
        
        if (!fs.existsSync('./uploads')) {
            fs.mkdirSync('./uploads');
        }
        
        const writer = fs.createWriteStream(filepath);
        videoResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('✅ Video downloaded successfully');

        // Get video info
        const title = data.title || data.caption || 'Instagram Reel';
        const username = data.owner?.username || data.username || 'Unknown';
        const likes = data.like_count || data.likes || 'N/A';
        const views = data.view_count || data.views || 'N/A';

        // Upload to Discord
        const attachment = new AttachmentBuilder(filepath, { name: filename });
        
        const embedMessage = message || 
            `🎬 **Instagram Reel Downloaded**\n` +
            `📝 **Title:** ${title}\n` +
            `👤 **Author:** @${username}\n` +
            `❤️ **Likes:** ${likes}\n` +
            `👁️ **Views:** ${views}\n` +
            `🔗 **Source:** ${url}`;

        await channel.send({
            content: embedMessage,
            files: [attachment]
        });

        // Delete temporary file
        fs.unlinkSync(filepath);

        res.json({
            success: true,
            reel: {
                title,
                username,
                likes,
                views,
                url
            },
            channel: channel.name
        });

    } catch (error) {
        console.error('Instagram download error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to download Instagram reel',
            details: 'Make sure you have a valid RapidAPI key configured'
        });
    }
});

// Discord Bot Events
client.once('ready', () => {
    console.log('✅ videoWiper Bot is online!');
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`🌐 Web interface running on http://localhost:${PORT}`);
    
    client.user.setActivity('Managing uploads', { type: 3 });
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`🚀 videoWiper server started on port ${PORT}`);
});

// Login to Discord (guarded so server can run without a token set)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (DISCORD_TOKEN && DISCORD_TOKEN !== 'your_bot_token_here') {
    client.login(DISCORD_TOKEN).catch(err => console.error('Discord login failed:', err));
} else {
    console.warn('⚠️ DISCORD_TOKEN not set or placeholder detected. Discord client will not log in. Set DISCORD_TOKEN in .env to enable bot functionality.');
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down videoWiper...');
    client.destroy();
    process.exit(0);
});

// Convert Instagram URLs/shortcodes and post masked links to Discord channel
app.post('/api/post-instagram', express.json(), async (req, res) => {
    try {
        const { urls, message, embedOnly } = req.body || {};
        const channelId = (req.body && req.body.channelId) || channelConfig.channelId;

        if (!channelId) return res.status(400).json({ success: false, error: 'Channel not configured' });

        const channel = client.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ success: false, error: 'No URLs provided' });
        }

        // Use the existing test runner script to resolve media URLs.
        // It prints JSON prefixed with "RESULT: ". We'll run it via node for each shortcode.
        const { execFile } = require('child_process');
        const runInstaScript = (shortcode) => new Promise((resolve, reject) => {
            // Run the script from the project directory using a relative script path so ESM loader resolves relative imports correctly on Windows.
            const relScriptPath = path.join('scripts', 'test-insta-run.mjs');
            execFile(process.execPath, [relScriptPath, shortcode], { windowsHide: true, maxBuffer: 1024 * 1024 * 5, cwd: __dirname }, (err, stdout, stderr) => {
                if (err) return reject({ err, stdout, stderr });
                // script prints: RESULT: {...}\n
                const out = String(stdout || '').trim();
                const marker = 'RESULT:';
                const idx = out.indexOf(marker);
                if (idx === -1) {
                    return reject(new Error('Unexpected script output: ' + out + ' ' + String(stderr || '')));
                }
                const jsonPart = out.slice(idx + marker.length).trim();
                try {
                    const parsed = JSON.parse(jsonPart);
                    resolve(parsed);
                } catch (e) {
                    return reject(new Error('Failed to parse JSON from script output: ' + e.message + ' -- ' + jsonPart));
                }
            });
        });

        const posted = [];

        for (const rawUrl of urls) {
            try {
                if (!rawUrl || typeof rawUrl !== 'string') continue;
                // try to extract shortcode or shareId
                let shortcode = null;
                let shareId = null;
                try {
                    const u = new URL(rawUrl);
                    const parts = u.pathname.split('/').filter(Boolean);
                    // common forms: /p/{id}/, /reel/{id}/, /share/{id}/
                    if (parts.length >= 2) {
                        if (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') shortcode = parts[1];
                        if (parts[0] === 'share') shareId = parts[1];
                    }
                } catch (e) {
                    // not a valid URL; maybe user provided shortcode directly
                    const s = rawUrl.trim();
                    if (/^[A-Za-z0-9_-]{5,}$/.test(s)) shortcode = s;
                }

                let info = null;
                if (shareId) {
                    // shareId -> try resolving via script by passing shareId
                    info = await runInstaScript(shareId).catch(e=>({ error: String(e && e.message ? e.message : e) }));
                } else if (shortcode) {
                    info = await runInstaScript(shortcode).catch(e=>({ error: String(e && e.message ? e.message : e) }));
                } else {
                    // try to resolve by attempting to extract shortcode via redirect resolution
                    const resolved = await resolveRedirectingURL(rawUrl);
                    const id = resolved.postId || resolved.shareId;
                    if (id) info = await runInstaScript(id).catch(e=>({ error: String(e && e.message ? e.message : e) }));
                    else info = { error: 'could not-resolve-id' };
                }

                // extract a usable media URL
                let mediaUrl = null;
                let isPhoto = false;
                if (info?.urls) mediaUrl = info.urls;
                else if (info?.picker && Array.isArray(info.picker) && info.picker.length) mediaUrl = info.picker[0].url;
                else if (info?.isPhoto && info?.urls) { mediaUrl = info.urls; isPhoto = true; }

                if (!mediaUrl) {
                    // skip if no media
                    posted.push({ input: rawUrl, ok: false, error: info?.error || 'no_media' });
                    continue;
                }

                // create a masked embed with a friendly title
                const title = message && typeof message === 'string' && message.length ? message : `Instagram ${shortcode || shareId || 'media'}`;
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(`[${title}](${mediaUrl})`)
                    .setURL(mediaUrl)
                    .setTimestamp();

                if (isPhoto) embed.setImage(mediaUrl);

                await channel.send({ content: message && message.length ? message : undefined, embeds: [embed] });
                posted.push({ input: rawUrl, ok: true, url: mediaUrl });
            } catch (e) {
                posted.push({ input: rawUrl, ok: false, error: e && e.message ? e.message : String(e) });
            }
        }

        res.json({ success: true, posted });
    } catch (error) {
        console.error('Error in /api/post-instagram:', error);
        res.status(500).json({ success: false, error: error && error.message ? error.message : String(error) });
    }
});