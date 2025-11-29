#!/usr/bin/env node
// Minimal Instagram media URL extractor (best-effort, public posts only)
// Exports: getInstagramMediaUrl(shortcode) -> returns direct media URL or null
// Usage (CLI): node scripts/instagram-url-minimal.mjs <shortcode>

async function getFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  // dynamic import of node-fetch for older Node versions
  try {
    const mod = await import('node-fetch');
    return mod.default || mod;
  } catch (e) {
    throw new Error('No fetch available. Please run on Node 18+ or install node-fetch');
  }
}

function pickBestVideoFromMedia(media) {
  if (!media) return null;

  // direct video_url
  if (media.video_url) return media.video_url;

  // video_versions (mobile style)
  if (media.video_versions && Array.isArray(media.video_versions) && media.video_versions.length) {
    const best = media.video_versions.reduce((a, b) => (a.width * a.height) - (b.width * b.height) < 0 ? b : a);
    return best?.url || null;
  }

  // image_versions2 candidates (photo fallback)
  if (media.image_versions2?.candidates && media.image_versions2.candidates.length) {
    return media.image_versions2.candidates[0].url;
  }

  // older display_url
  if (media.display_url) return media.display_url;

  // sidecar (carousel) - find first video node
  const sidecar = media.edge_sidecar_to_children?.edges || media.edge_sidecar_to_children?.edges;
  if (sidecar && Array.isArray(sidecar)) {
    for (const edge of sidecar) {
      const node = edge?.node;
      if (!node) continue;
      if (node.is_video && node.video_url) return node.video_url;
      if (node.video_versions && node.video_versions.length) {
        const best = node.video_versions.reduce((a, b) => (a.width * a.height) - (b.width * b.height) < 0 ? b : a);
        if (best?.url) return best.url;
      }
      if (node.display_url) return node.display_url;
    }
  }

  return null;
}

// Try the i.instagram.com oembed -> mobile API flow to get media_id and media info
async function tryOembedThenMobile(shortcode, fetchFn) {
  try {
    const mobileHeaders = {
      'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423)',
      'Accept': 'application/json, text/javascript',
      'x-ig-app-id': '936619743392459'
    };

    // Try oembed for both /p/ and /reel/ forms
    const variants = [`https://www.instagram.com/p/${shortcode}/`, `https://www.instagram.com/reel/${shortcode}/`];
    for (const v of variants) {
      const oembedURL = `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(v)}`;
      try {
        const r = await fetchFn(oembedURL, { headers: mobileHeaders });
        if (!r || !r.ok) continue;
        const o = await r.json().catch(() => null);
        const mediaId = o?.media_id;
        if (!mediaId) continue;

        // fetch mobile media info
        const infoUrl = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;
        const infoRes = await fetchFn(infoUrl, { headers: mobileHeaders });
        if (!infoRes || !infoRes.ok) continue;
        const info = await infoRes.json().catch(() => null);
        const item = info?.items?.[0];
        const candidate = pickBestVideoFromMedia(item);
        if (candidate) return candidate;
      } catch (e) {
        // ignore and try next variant
      }
    }
  } catch (e) {}
  return null;
}

async function extractFromJsonResponse(json) {
  // try several places where Instagram places the media object
  const mediaCandidates = [
    json?.graphql?.shortcode_media,
    json?.items?.[0],
    json?.media || json?.edge_media_to_caption || json
  ];

  for (const cand of mediaCandidates) {
    const url = pickBestVideoFromMedia(cand);
    if (url) return url;
  }

  // sometimes the response structure is nested deeper
  try {
    // search the object for keys named "shortcode_media"
    const stack = [json];
    while (stack.length) {
      const obj = stack.pop();
      if (!obj || typeof obj !== 'object') continue;
      if (obj.shortcode_media) {
        const url = pickBestVideoFromMedia(obj.shortcode_media);
        if (url) return url;
      }
      for (const v of Object.values(obj)) if (typeof v === 'object') stack.push(v);
    }
  } catch {}

  return null;
}

async function extractFromHtml(html) {
  // look for window._sharedData = { ... };
  let m = html.match(/window\._sharedData\s*=\s*(\{.*?\});/s);
  let jsonStr = m?.[1];

  // some pages use other scripts that embed JSON via <script>...</script>
  if (!jsonStr) {
    // fallback: try to find any script that contains "shortcode_media"
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?shortcode_media[\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      // try to extract {...} fragments inside
      const objMatch = scriptMatch[1].match(/(\{[\s\S]*\})/m);
      jsonStr = objMatch?.[1];
    }
  }

  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);
    return extractFromJsonResponse(data);
  } catch (e) {
    // sometimes JSON is wrapped or has trailing commas; best-effort: try to find the "shortcode_media" object text
    try {
      const sm = jsonStr.match(/"shortcode_media"\s*:\s*(\{[\s\S]*\})/);
      if (sm) {
        const obj = JSON.parse('{' + sm[1] + '}');
        return pickBestVideoFromMedia(obj.shortcode_media || obj);
      }
    } catch (e2) {}
  }
  return null;
}

import { pathToFileURL } from 'url';

export async function getInstagramMediaUrl(shortcode) {
  if (!shortcode) throw new Error('shortcode is required');
  const fetchFn = await getFetch();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/json'
  };

  // try ?__a=1 JSON endpoint first (works sometimes for public posts)
  const jsonUrls = [
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`
  ];
  try {
    for (const jsonUrl of jsonUrls) {
      try {
        const res = await fetchFn(jsonUrl, { headers });
        if (!res) continue;
        if (res.ok) {
          const contentType = res.headers?.get?.('content-type') || '';
          if (contentType.includes('application/json') || contentType.includes('text/json')) {
            const json = await res.json();
            const url = await extractFromJsonResponse(json);
            if (url) return url;
          } else {
            // sometimes Instagram returns HTML even for this URL
            const text = await res.text();
            const url = await extractFromHtml(text);
            if (url) return url;
          }
        }
      } catch (e) {
        // try next jsonUrl
      }
    }
  } catch (e) {
    // ignore and fallback to page HTML
  }

  // Try oembed -> mobile info flow which can return higher success for reels
  try {
    const mobileCandidate = await tryOembedThenMobile(shortcode, fetchFn);
    if (mobileCandidate) return mobileCandidate;
  } catch (e) {}

  // fallback: fetch the post page HTML directly
  try {
    const pageUrl = `https://www.instagram.com/p/${shortcode}/`;
    const res = await fetchFn(pageUrl, { headers });
    const html = await res.text();
    const url = await extractFromHtml(html);
    if (url) return url;
  } catch (e) {
    // ignore
  }

  return null;
}

// CLI entry: only run when the module is executed directly (not when imported)
try {
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    (async () => {
      const sc = process.argv[2];
      if (!sc) {
        console.error('Usage: node scripts/instagram-url-minimal.mjs <shortcode>');
        process.exit(2);
      }

      try {
        const url = await getInstagramMediaUrl(sc);
        if (url) console.log(url);
        else {
          console.error('No media URL found (public posts only, best-effort).');
          process.exit(1);
        }
      } catch (err) {
        console.error('Error:', err.message || err);
        process.exit(1);
      }
    })();
  }
} catch (e) {
  // ignore any environment quirks when comparing import.meta.url
}
