require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
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
app.use(cors());
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});

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
    console.log(`🌐 Web interface running on ${process.env.API_DOMAIN || 'http://localhost:'}${PORT}`);
    
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
// app.post('/api/post-instagram', express.json(), async (req, res) => {
//     try {
//         const { urls, message, embedOnly } = req.body || {};
//         const channelId = (req.body && req.body.channelId) || channelConfig.channelId;

//         if (!channelId) return res.status(400).json({ success: false, error: 'Channel not configured' });

//         const channel = client.channels.cache.get(channelId);
//         if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

//         if (!urls || !Array.isArray(urls) || urls.length === 0) {
//             return res.status(400).json({ success: false, error: 'No URLs provided' });
//         }

//         // Use the existing test runner script to resolve media URLs.
//         const { execFile } = require('child_process');
//         const runInstaScript = (shortcode) => new Promise((resolve, reject) => {
//             const relScriptPath = path.join('scripts', 'test-insta-run.mjs');
//             execFile(process.execPath, [relScriptPath, shortcode], { 
//                 windowsHide: true, 
//                 maxBuffer: 1024 * 1024 * 5, 
//                 cwd: __dirname 
//             }, (err, stdout, stderr) => {
//                 if (err) return reject({ err, stdout, stderr });
//                 const out = String(stdout || '').trim();
//                 const marker = 'RESULT:';
//                 const idx = out.indexOf(marker);
//                 if (idx === -1) {
//                     return reject(new Error('Unexpected script output: ' + out + ' ' + String(stderr || '')));
//                 }
//                 const jsonPart = out.slice(idx + marker.length).trim();
//                 try {
//                     const parsed = JSON.parse(jsonPart);
//                     resolve(parsed);
//                 } catch (e) {
//                     return reject(new Error('Failed to parse JSON from script output: ' + e.message + ' -- ' + jsonPart));
//                 }
//             });
//         });

//         const posted = [];

//         for (const rawUrl of urls) {
//             try {
//                 if (!rawUrl || typeof rawUrl !== 'string') continue;
                
//                 // Extract shortcode or shareId
//                 let shortcode = null;
//                 let shareId = null;
//                 try {
//                     const u = new URL(rawUrl);
//                     const parts = u.pathname.split('/').filter(Boolean);
//                     if (parts.length >= 2) {
//                         if (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') shortcode = parts[1];
//                         if (parts[0] === 'share') shareId = parts[1];
//                     }
//                 } catch (e) {
//                     const s = rawUrl.trim();
//                     if (/^[A-Za-z0-9_-]{5,}$/.test(s)) shortcode = s;
//                 }

//                 let info = null;
//                 if (shareId) {
//                     info = await runInstaScript(shareId).catch(e=>({ error: String(e && e.message ? e.message : e) }));
//                 } else if (shortcode) {
//                     info = await runInstaScript(shortcode).catch(e=>({ error: String(e && e.message ? e.message : e) }));
//                 } else {
//                     const resolved = await resolveRedirectingURL(rawUrl);
//                     const id = resolved.postId || resolved.shareId;
//                     if (id) info = await runInstaScript(id).catch(e=>({ error: String(e && e.message ? e.message : e) }));
//                     else info = { error: 'could not-resolve-id' };
//                 }

//                 // Handle carousel posts (multiple images/videos)
//                 if (info?.picker && Array.isArray(info.picker) && info.picker.length > 0) {
//                     // Post each item from the carousel separately
//                     for (let i = 0; i < info.picker.length; i++) {
//                         const item = info.picker[i];
//                         if (!item || !item.url) continue;

//                         const isPhoto = item.type === 'photo';
//                         const itemTitle = message && typeof message === 'string' && message.length 
//                             ? `${message}${info.picker.length > 1 ? ` (${i + 1}/${info.picker.length})` : ''}` 
//                             : `Instagram ${shortcode || shareId || 'media'}${info.picker.length > 1 ? ` (${i + 1}/${info.picker.length})` : ''}`;

//                         const embed = new EmbedBuilder()
//                             .setTitle(itemTitle)
//                             .setURL(`https://www.instagram.com/p/${shortcode || shareId}/`)
//                             .setTimestamp();

//                         if (isPhoto) {
//                             embed.setImage(item.url);
//                         } else {
//                             // For videos, set thumbnail if available
//                             if (item.thumb) {
//                                 embed.setImage(item.thumb);
//                             }
//                         }

//                         // For videos, include the video URL in the content
//                         const content = !isPhoto ? item.url : (i === 0 && message && message.length ? message : undefined);

//                         await channel.send({ 
//                             content: content, 
//                             embeds: [embed] 
//                         });

//                         posted.push({ 
//                             input: rawUrl, 
//                             ok: true, 
//                             url: item.url, 
//                             type: item.type,
//                             index: i + 1,
//                             total: info.picker.length
//                         });
//                     }
//                 } 
//                 // Handle single media (photo or video)
//                 else {
//                     let mediaUrl = null;
//                     let isPhoto = false;

//                     if (info?.urls) {
//                         mediaUrl = info.urls;
//                         isPhoto = info.isPhoto || false;
//                     }

//                     if (!mediaUrl) {
//                         posted.push({ input: rawUrl, ok: false, error: info?.error || 'no_media' });
//                         continue;
//                     }

//                     const title = message && typeof message === 'string' && message.length 
//                         ? message 
//                         : `Instagram ${shortcode || shareId || 'media'}`;

//                     const embed = new EmbedBuilder()
//                         .setTitle(title)
//                         .setURL(`https://www.instagram.com/p/${shortcode || shareId}/`)
//                         .setTimestamp();

//                     if (isPhoto) {
//                         embed.setImage(mediaUrl);
//                     } else {
//                         // For videos, we might not have a thumbnail in single media case
//                         // Just send the video URL
//                     }

//                     const content = !isPhoto ? mediaUrl : (message && message.length ? message : undefined);

//                     await channel.send({ 
//                         content: content, 
//                         embeds: [embed] 
//                     });

//                     posted.push({ 
//                         input: rawUrl, 
//                         ok: true, 
//                         url: mediaUrl, 
//                         type: isPhoto ? 'photo' : 'video' 
//                     });
//                 }
//             } catch (e) {
//                 posted.push({ 
//                     input: rawUrl, 
//                     ok: false, 
//                     error: e && e.message ? e.message : String(e) 
//                 });
//             }
//         }

//         res.json({ success: true, posted });
//     } catch (error) {
//         console.error('Error in /api/post-instagram:', error);
//         res.status(500).json({ 
//             success: false, 
//             error: error && error.message ? error.message : String(error) 
//         });
//     }
// });

// Convert Instagram URLs/shortcodes and post masked links to Discord channel
// app.post('/api/post-instagram', express.json(), async (req, res) => {
//     try {
//         const { urls, message, embedOnly } = req.body || {};
//         const channelId = (req.body && req.body.channelId) || channelConfig.channelId;

//         if (!channelId) return res.status(400).json({ success: false, error: 'Channel not configured' });

//         const channel = client.channels.cache.get(channelId);
//         if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

//         if (!urls || !Array.isArray(urls) || urls.length === 0) {
//             return res.status(400).json({ success: false, error: 'No URLs provided' });
//         }

//         // Use the existing test runner script to resolve media URLs.
//         const { execFile } = require('child_process');
//         const runInstaScript = (shortcode) => new Promise((resolve, reject) => {
//             const relScriptPath = path.join('scripts', 'test-insta-run.mjs');
//             execFile(process.execPath, [relScriptPath, shortcode], { 
//                 windowsHide: true, 
//                 maxBuffer: 1024 * 1024 * 5, 
//                 cwd: __dirname 
//             }, (err, stdout, stderr) => {
//                 if (err) return reject({ err, stdout, stderr });
//                 const out = String(stdout || '').trim();
//                 const marker = 'RESULT:';
//                 const idx = out.indexOf(marker);
//                 if (idx === -1) {
//                     return reject(new Error('Unexpected script output: ' + out + ' ' + String(stderr || '')));
//                 }
//                 const jsonPart = out.slice(idx + marker.length).trim();
//                 try {
//                     const parsed = JSON.parse(jsonPart);
//                     resolve(parsed);
//                 } catch (e) {
//                     return reject(new Error('Failed to parse JSON from script output: ' + e.message + ' -- ' + jsonPart));
//                 }
//             });
//         });

//         // Helper function to fetch Instagram post caption
//         const fetchCaption = async (shortcode) => {
//             try {
//                 const url = `https://www.instagram.com/p/${shortcode}/`;
//                 const response = await fetch(url, {
//                     headers: {
//                         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
//                     }
//                 });
//                 const html = await response.text();
                
//                 // Try og:description meta tag
//                 let match = html.match(/<meta property="og:description" content="([^"]*?)"\s*\/>/i);
//                 if (match && match[1]) {
//                     const caption = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
//                     console.log('📝 Instagram Caption:', caption);
//                     return caption;
//                 }
                
//                 // Try regular description meta tag
//                 match = html.match(/<meta name="description" content="([^"]*?)"\s*\/>/i);
//                 if (match && match[1]) {
//                     const caption = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
//                     console.log('📝 Instagram Caption:', caption);
//                     return caption;
//                 }
                
//                 console.log('⚠️ No caption found for shortcode:', shortcode);
//                 return null;
//             } catch (e) {
//                 console.error('❌ Error fetching caption:', e.message);
//                 return null;
//             }
//         };

//         const posted = [];

//         for (const rawUrl of urls) {
//             try {
//                 if (!rawUrl || typeof rawUrl !== 'string') continue;
                
//                 // Extract shortcode or shareId
//                 let shortcode = null;
//                 let shareId = null;
//                 try {
//                     const u = new URL(rawUrl);
//                     const parts = u.pathname.split('/').filter(Boolean);
//                     if (parts.length >= 2) {
//                         if (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') shortcode = parts[1];
//                         if (parts[0] === 'share') shareId = parts[1];
//                     }
//                 } catch (e) {
//                     const s = rawUrl.trim();
//                     if (/^[A-Za-z0-9_-]{5,}$/.test(s)) shortcode = s;
//                 }

//                 let info = null;
//                 if (shareId) {
//                     info = await runInstaScript(shareId).catch(e=>({ error: String(e && e.message ? e.message : e) }));
//                 } else if (shortcode) {
//                     info = await runInstaScript(shortcode).catch(e=>({ error: String(e && e.message ? e.message : e) }));
//                 } else {
//                     const resolved = await resolveRedirectingURL(rawUrl);
//                     const id = resolved.postId || resolved.shareId;
//                     if (id) info = await runInstaScript(id).catch(e=>({ error: String(e && e.message ? e.message : e) }));
//                     else info = { error: 'could not-resolve-id' };
//                 }

//                 // Fetch the Instagram post caption/title
//                 const postCaption = shortcode ? await fetchCaption(shortcode) : null;
//                 const postTitle = postCaption || (message && typeof message === 'string' && message.length ? message : null);
                
//                 console.log('🔍 Processing URL:', rawUrl);
//                 console.log('🆔 Shortcode:', shortcode || shareId);
//                 console.log('📋 Post Info:', JSON.stringify(info, null, 2));

//                 // Handle carousel posts (multiple images/videos)
//                 if (info?.picker && Array.isArray(info.picker) && info.picker.length > 0) {
//                     console.log(`📸 Carousel detected with ${info.picker.length} items`);
                    
//                     // Post each item from the carousel separately
//                     for (let i = 0; i < info.picker.length; i++) {
//                         const item = info.picker[i];
//                         if (!item || !item.url) continue;

//                         const isPhoto = item.type === 'photo';
                        
//                         // Use fetched caption as title, with numbering for multiple items
//                         const itemTitle = postTitle 
//                             ? `${postTitle}${info.picker.length > 1 ? ` (${i + 1}/${info.picker.length})` : ''}` 
//                             : `Instagram ${shortcode || shareId || 'media'}${info.picker.length > 1 ? ` (${i + 1}/${info.picker.length})` : ''}`;

//                         console.log(`  ➡️ Item ${i + 1}/${info.picker.length}: ${item.type} - ${itemTitle}`);

//                         const embed = new EmbedBuilder()
//                             .setTitle(itemTitle.slice(0, 256)) // Discord title limit
//                             .setURL(`https://www.instagram.com/p/${shortcode || shareId}/`)
//                             .setTimestamp();

//                         if (isPhoto) {
//                             embed.setImage(item.url);
//                         } else {
//                             // For videos, set thumbnail if available
//                             if (item.thumb) {
//                                 embed.setImage(item.thumb);
//                             }
//                         }

//                         // For videos, include the video URL in the content
//                         const content = !isPhoto ? item.url : (i === 0 && message && message.length ? message : undefined);

//                         await channel.send({ 
//                             content: content, 
//                             embeds: [embed] 
//                         });

//                         console.log(`  ✅ Posted item ${i + 1}/${info.picker.length}`);

//                         posted.push({ 
//                             input: rawUrl, 
//                             ok: true, 
//                             url: item.url, 
//                             type: item.type,
//                             index: i + 1,
//                             total: info.picker.length,
//                             title: itemTitle
//                         });
//                     }
//                 } 
//                 // Handle single media (photo or video)
//                 else {
//                     console.log('📷 Single media detected');
                    
//                     let mediaUrl = null;
//                     let isPhoto = false;

//                     if (info?.urls) {
//                         mediaUrl = info.urls;
//                         isPhoto = info.isPhoto || false;
//                     }

//                     if (!mediaUrl) {
//                         console.log('❌ No media URL found');
//                         posted.push({ input: rawUrl, ok: false, error: info?.error || 'no_media' });
//                         continue;
//                     }

//                     const title = postTitle || `Instagram ${shortcode || shareId || 'media'}`;
//                     console.log(`  ➡️ Single ${isPhoto ? 'photo' : 'video'}: ${title}`);

//                     const embed = new EmbedBuilder()
//                         .setTitle(title.slice(0, 256)) // Discord title limit
//                         .setURL(`https://www.instagram.com/p/${shortcode || shareId}/`)
//                         .setTimestamp();

//                     if (isPhoto) {
//                         embed.setImage(mediaUrl);
//                     } else {
//                         // For videos, we might not have a thumbnail in single media case
//                         // Just send the video URL
//                     }

//                     const content = !isPhoto ? mediaUrl : (message && message.length ? message : undefined);

//                     await channel.send({ 
//                         content: content, 
//                         embeds: [embed] 
//                     });

//                     console.log('  ✅ Posted single media',);

//                     posted.push({ 
//                         input: rawUrl, 
//                         ok: true, 
//                         url: mediaUrl, 
//                         type: isPhoto ? 'photo' : 'video',
//                         title: title
//                     });
//                 }
//             } catch (e) {
//                 console.error('❌ Error processing URL:', rawUrl, e);
//                 posted.push({ 
//                     input: rawUrl, 
//                     ok: false, 
//                     error: e && e.message ? e.message : String(e) 
//                 });
//             }
//         }

//         console.log('🎉 Finished processing all URLs');
//         console.log('📊 Results:', JSON.stringify(posted, null, 2));
        
//         res.json({ success: true, posted });
//     } catch (error) {
//         console.error('💥 Fatal error in /api/post-instagram:', error);
//         res.status(500).json({ 
//             success: false, 
//             error: error && error.message ? error.message : String(error) 
//         });
//     }
// });


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
        const { execFile } = require('child_process');
        const runInstaScript = (shortcode) => new Promise((resolve, reject) => {
            const relScriptPath = path.join('scripts', 'test-insta-run.mjs');
            execFile(process.execPath, [relScriptPath, shortcode], { 
                windowsHide: true, 
                maxBuffer: 1024 * 1024 * 5, 
                cwd: __dirname 
            }, (err, stdout, stderr) => {
                if (err) return reject({ err, stdout, stderr });
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

        // Helper function to fetch Instagram post caption and creator info
        const fetchInstagramData = async (shortcode) => {
            try {
                const url = `https://www.instagram.com/p/${shortcode}/`;
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const html = await response.text();
                
                const result = {
                    caption: null,
                    username: null,
                    fullName: null
                };
                
                // Extract caption from og:description or meta description
                let match = html.match(/<meta property="og:description" content="([^"]*?)"\s*\/>/i);
                if (match && match[1]) {
                    result.caption = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
                } else {
                    match = html.match(/<meta name="description" content="([^"]*?)"\s*\/>/i);
                    if (match && match[1]) {
                        result.caption = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
                    }
                }
                
                // Extract username from og:title or title tag
                // Format is usually: "Username on Instagram: "Caption text""
                match = html.match(/<meta property="og:title" content="([^"]*?)"/i);
                if (match && match[1]) {
                    const titleContent = match[1];
                    // Try to extract username from "Username on Instagram" format
                    const usernameMatch = titleContent.match(/^(.+?)\s+(?:on Instagram|@)/i);
                    if (usernameMatch && usernameMatch[1]) {
                        result.fullName = usernameMatch[1].trim();
                    }
                }
                
                // Try to extract username from URL pattern or JSON data
                match = html.match(/"username":"([^"]+)"/);
                if (match && match[1]) {
                    result.username = match[1];
                }
                
                // Alternative: extract from alternateName in JSON-LD
                match = html.match(/"alternateName":"@([^"]+)"/);
                if (match && match[1] && !result.username) {
                    result.username = match[1];
                }
                
                // Extract from owner username in shared data
                match = html.match(/"owner":\{"username":"([^"]+)"/);
                if (match && match[1] && !result.username) {
                    result.username = match[1];
                }
                
                console.log('📝 Instagram Caption:', result.caption || 'None');
                console.log('👤 Creator Username:', result.username || 'Unknown');
                console.log('✨ Creator Name:', result.fullName || 'Unknown');
                
                return result;
            } catch (e) {
                console.error('❌ Error fetching Instagram data:', e.message);
                return { caption: null, username: null, fullName: null };
            }
        };

        const posted = [];

        for (const rawUrl of urls) {
            try {
                if (!rawUrl || typeof rawUrl !== 'string') continue;
                
                // Extract shortcode or shareId
                let shortcode = null;
                let shareId = null;
                try {
                    const u = new URL(rawUrl);
                    const parts = u.pathname.split('/').filter(Boolean);
                    if (parts.length >= 2) {
                        if (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') shortcode = parts[1];
                        if (parts[0] === 'share') shareId = parts[1];
                    }
                } catch (e) {
                    const s = rawUrl.trim();
                    if (/^[A-Za-z0-9_-]{5,}$/.test(s)) shortcode = s;
                }

                let info = null;
                if (shareId) {
                    info = await runInstaScript(shareId).catch(e=>({ error: String(e && e.message ? e.message : e) }));
                } else if (shortcode) {
                    info = await runInstaScript(shortcode).catch(e=>({ error: String(e && e.message ? e.message : e) }));
                } else {
                    const resolved = await resolveRedirectingURL(rawUrl);
                    const id = resolved.postId || resolved.shareId;
                    if (id) info = await runInstaScript(id).catch(e=>({ error: String(e && e.message ? e.message : e) }));
                    else info = { error: 'could not-resolve-id' };
                }

                // Fetch the Instagram post caption/title and creator info
                const instagramData = shortcode ? await fetchInstagramData(shortcode) : { caption: null, username: null, fullName: null };
                const postCaption = instagramData.caption || (message && typeof message === 'string' && message.length ? message : null);
                const creatorUsername = instagramData.username;
                const creatorName = instagramData.fullName;
                
                console.log('🔍 Processing URL:', rawUrl);
                console.log('🆔 Shortcode:', shortcode || shareId);
                if (creatorUsername) console.log('👤 By: @' + creatorUsername + (creatorName ? ` (${creatorName})` : ''));
                console.log('📋 Post Info:', JSON.stringify(info, null, 2));

                // Handle carousel posts (multiple images/videos)
                if (info?.picker && Array.isArray(info.picker) && info.picker.length > 0) {
                    console.log(`📸 Carousel detected with ${info.picker.length} items`);
                    
                    // Post each item from the carousel separately
                    for (let i = 0; i < info.picker.length; i++) {
                        const item = info.picker[i];
                        if (!item || !item.url) continue;

                        const isPhoto = item.type === 'photo';
                        
                        // Use fetched caption as title, with numbering for multiple items
                        const itemTitle = postCaption 
                            ? `${postCaption}${info.picker.length > 1 ? ` (${i + 1}/${info.picker.length})` : ''}` 
                            : `Instagram ${shortcode || shareId || 'media'}${info.picker.length > 1 ? ` (${i + 1}/${info.picker.length})` : ''}`;

                        console.log(`  ➡️ Item ${i + 1}/${info.picker.length}: ${item.type} - ${itemTitle}`);

                        const embed = new EmbedBuilder()
                            .setTitle(itemTitle.slice(0, 256)) // Discord title limit
                            .setURL(`https://www.instagram.com/p/${shortcode || shareId}/`)
                            .setTimestamp();
                        
                        // Add creator info as footer
                        if (creatorUsername) {
                            embed.setFooter({ 
                                text: `Posted by @${creatorUsername}${creatorName ? ` (${creatorName})` : ''}` 
                            });
                        }

                        if (isPhoto) {
                            embed.setImage(item.url);
                        } else {
                            // For videos, set thumbnail if available
                            if (item.thumb) {
                                embed.setImage(item.thumb);
                            }
                        }

                        // For videos, include the video URL in the content
                        const content = !isPhoto ? item.url : (i === 0 && message && message.length ? message : undefined);

                        await channel.send({ 
                            content: content, 
                            embeds: [embed] 
                        });

                        console.log(`  ✅ Posted item ${i + 1}/${info.picker.length}`);

                        posted.push({ 
                            input: rawUrl, 
                            ok: true, 
                            url: item.url, 
                            type: item.type,
                            index: i + 1,
                            total: info.picker.length,
                            title: itemTitle,
                            creator: creatorUsername,
                            creatorName: creatorName
                        });
                    }
                } 
                // Handle single media (photo or video)
                else {
                    console.log('📷 Single media detected');
                    
                    let mediaUrl = null;
                    let isPhoto = false;

                    if (info?.urls) {
                        mediaUrl = info.urls;
                        isPhoto = info.isPhoto || false;
                    }

                    if (!mediaUrl) {
                        console.log('❌ No media URL found');
                        posted.push({ input: rawUrl, ok: false, error: info?.error || 'no_media' });
                        continue;
                    }

                    const title = postCaption || `Instagram ${shortcode || shareId || 'media'}`;
                    console.log(`  ➡️ Single ${isPhoto ? 'photo' : 'video'}: ${title}`);

                    const embed = new EmbedBuilder()
                        .setTitle(title.slice(0, 256)) // Discord title limit
                        .setURL(`https://www.instagram.com/p/${shortcode || shareId}/`)
                        .setTimestamp();
                    
                    // Add creator info as footer
                    if (creatorUsername) {
                        embed.setFooter({ 
                            text: `Posted by @${creatorUsername}${creatorName ? ` (${creatorName})` : ''}` 
                        });
                    }

                    if (isPhoto) {
                        embed.setImage(mediaUrl);
                    } else {
                        // For videos, we might not have a thumbnail in single media case
                        // Just send the video URL
                    }

                    const content = !isPhoto ? mediaUrl : (message && message.length ? message : undefined);

                    await channel.send({ 
                        content: content, 
                        embeds: [embed] 
                    });

                    console.log('  ✅ Posted single media');

                    posted.push({ 
                        input: rawUrl, 
                        ok: true, 
                        url: mediaUrl, 
                        type: isPhoto ? 'photo' : 'video',
                        title: title,
                        creator: creatorUsername,
                        creatorName: creatorName
                    });
                }
            } catch (e) {
                console.error('❌ Error processing URL:', rawUrl, e);
                posted.push({ 
                    input: rawUrl, 
                    ok: false, 
                    error: e && e.message ? e.message : String(e) 
                });
            }
        }

        console.log('🎉 Finished processing all URLs');
        console.log('📊 Results:', JSON.stringify(posted, null, 2));
        
        res.json({ success: true, posted });
    } catch (error) {
        console.error('💥 Fatal error in /api/post-instagram:', error);
        res.status(500).json({ 
            success: false, 
            error: error && error.message ? error.message : String(error) 
        });
    }
});