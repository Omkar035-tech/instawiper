const axios = require('axios');
const path = require('path');
const { pathToFileURL } = require('url');

// Helper: extract shortcode from a full Instagram URL or accept shortcode directly
function extractShortcode(input) {
	if (!input) return null;
	try {
		// if it's just shortcode
		if (/^[A-Za-z0-9_-]{5,}$/.test(input)) return input;
		const u = new URL(input);
		const parts = u.pathname.split('/').filter(Boolean);
		// handle /p/{id}, /reel/{id}, /tv/{id}
		if (parts.length >= 2) return parts[1];
	} catch (e) {
		// not a URL, maybe shortcode
		if (/^[A-Za-z0-9_-]{5,}$/.test(input)) return input;
	}
	return null;
}

async function fetchCaption(shortcode) {
	try {
		const url = `https://www.instagram.com/p/${shortcode}/`;
		const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
		const html = r.data || '';
		// Try og:description or meta name="description"
		let m = html.match(/<meta property="og:description" content="([\s\S]*?)"\s*\/>/i);
		if (m && m[1]) return decodeHtmlEntities(m[1]).trim();
		m = html.match(/<meta name="description" content="([\s\S]*?)"\s*\/>/i);
		if (m && m[1]) return decodeHtmlEntities(m[1]).trim();
	} catch (e) {}
	return null;
}

function decodeHtmlEntities(str) {
	if (!str) return str;
	return str.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Vercel serverless function: resolves instagram media (including carousels) and posts each media item with caption.
module.exports = async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	if (req.method === 'OPTIONS') return res.status(204).end();
	if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

	let body = req.body;
	if (typeof body === 'string') {
		try { body = JSON.parse(body); } catch (e) { /* ignore */ }
	}

	const { urls, message } = body || {};
	if (!urls || !Array.isArray(urls) || urls.length === 0) {
		return res.status(400).json({ error: 'Provide an array of Instagram URLs or shortcodes in the request body' });
	}

	const webhook = process.env.DISCORD_WEBHOOK_URL;
	if (!webhook) return res.status(500).json({ error: 'DISCORD_WEBHOOK_URL not configured' });

	// Import the ESM instagram service dynamically
	const svcPath = path.resolve(process.cwd(), 'scripts', 'instagram-service-standalone.mjs');
	let instagramService;
	try {
		const mod = await import(pathToFileURL(svcPath).href);
		instagramService = mod.default;
	} catch (e) {
		return res.status(500).json({ error: 'Failed to load instagram service', detail: String(e) });
	}

	const results = [];

	// For each provided URL/shortcode, resolve media and post each media item separately
	for (const input of urls) {
		const shortcode = extractShortcode(input);
		if (!shortcode) {
			results.push({ input, ok: false, error: 'Could not extract shortcode' });
			continue;
		}

		// fetch caption for title
		const caption = await fetchCaption(shortcode).catch(()=>null);

		let info;
		try {
			info = await instagramService({ postId: shortcode });
		} catch (e) {
			results.push({ input, shortcode, ok: false, error: 'instagram service error: ' + String(e) });
			continue;
		}

		// info may contain picker (array) or urls/isPhoto
		const mediaItems = [];
		if (info && info.picker && Array.isArray(info.picker)) {
			for (const p of info.picker) {
				// p: { type, url, thumb }
				if (p && p.url) mediaItems.push({ url: p.url, type: p.type || 'photo', thumb: p.thumb });
			}
		} else if (info && info.urls) {
			// single url (could be string)
			if (Array.isArray(info.urls)) {
				for (const u of info.urls) mediaItems.push({ url: u, type: 'photo' });
			} else mediaItems.push({ url: info.urls, type: info.isPhoto ? 'photo' : 'video' });
		}

		if (!mediaItems.length) {
			results.push({ input, shortcode, ok: false, error: 'No media found' });
			continue;
		}

		// Post each media item separately (one embed per media) to preserve order and captions
		for (const m of mediaItems) {
			const embed = {
				title: caption ? String(caption).slice(0, 256) : `Instagram post ${shortcode}`,
				url: `https://www.instagram.com/p/${shortcode}/`,
			};
			// for photos use embed.image; for videos attach content with url and set thumbnail if available
			if (m.type === 'photo') embed.image = { url: m.url };
			else {
				// use thumbnail as image and include video link in content
				if (m.thumb) embed.image = { url: m.thumb };
			}

			const payload = {
				content: m.type === 'video' ? `${m.url}` : (message || undefined),
				embeds: [embed]
			};

			try {
				await axios.post(webhook, payload, { timeout: 15000 });
				results.push({ input, shortcode, media: m.url, ok: true });
			} catch (err) {
				results.push({ input, shortcode, media: m.url, ok: false, error: err.message || String(err) });
			}
		}
	}

	return res.status(200).json({ results });
};

