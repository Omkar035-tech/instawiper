#!/usr/bin/env node
// CLI wrapper for scripts/instagram-service-standalone.mjs
import instagram from './instagram-service-standalone.mjs';

const shortcode = process.argv[2];
if (!shortcode) {
  console.error('Usage: node scripts/get-instagram-url-standalone.mjs <shortcode>');
  process.exit(2);
}

(async () => {
  try {
    const r = await instagram({ postId: shortcode });
    if (r?.picker) {
      for (const p of r.picker) console.log(p.url);
      process.exit(0);
    }
    if (r?.urls) { console.log(r.urls); process.exit(0); }
    console.error('No media URL found:', JSON.stringify(r));
    process.exit(1);
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
