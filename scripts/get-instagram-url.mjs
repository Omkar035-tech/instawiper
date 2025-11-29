#!/usr/bin/env node

/*
 Small example script that uses the repository's Instagram service to print a
 direct video URL (best-effort). Usage:

   node scripts/get-instagram-url.mjs <shortcode>

 Example shortcode: Cg0X7... (the part in an instagram post/reel URL)
*/

import instagram from '../services/instagram.mjs';

const shortcode = process.argv[2];
if (!shortcode) {
  console.error('Usage: node scripts/get-instagram-url.mjs <shortcode>');
  process.exit(2);
}

(async function main() {
  try {
    const result = await instagram({ postId: shortcode });

    if (!result) {
      console.error('No result returned');
      process.exit(1);
    }

    if (result.error) {
      console.error('Service returned error:', result);
      process.exit(1);
    }

    // Multi-item posts (carousel): `picker` contains items with `url` (or proxied URL)
    if (Array.isArray(result.picker)) {
      result.picker.forEach((item, i) => {
        console.log(`${i + 1}. ${item.url}`);
      });
      return;
    }

    // Single video/photo: `urls` may be a string (or rarely an array)
    const urls = result.urls || result.url;
    if (Array.isArray(urls)) {
      urls.forEach(u => console.log(u));
      return;
    }

    if (typeof urls === 'string') {
      console.log(urls);
      return;
    }

    // Fallback: print the whole returned object
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error while fetching:', err);
    process.exit(1);
  }
})();
