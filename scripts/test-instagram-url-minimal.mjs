#!/usr/bin/env node
// Simple smoke-test for scripts/instagram-url-minimal.mjs
// Exits 0 if at least one media URL is found, non-zero otherwise.

import { getInstagramMediaUrl } from './instagram-url-minimal.mjs';

const shortcodes = [
  'DQMWGqYjHXJ', // public video post
];

(async () => {
  console.log('Running smoke-test for instagram-url-minimal...');
  let found = 0;

  for (const sc of shortcodes) {
    try {
      process.stdout.write(`Checking ${sc} ... `);
      const url = await getInstagramMediaUrl(sc);
      if (url) {
        console.log('FOUND ->', url);
        found++;
      } else {
        console.log('no url');
      }
    } catch (err) {
      console.log('error ->', err && err.message ? err.message : err);
    }
  }

  if (found > 0) {
    console.log(`\nSmoke-test passed: found ${found} media URL(s).`);
    process.exit(0);
  } else {
    console.error('\nSmoke-test failed: no media URLs found. (This can happen if the sample posts are removed/private or Instagram blocked the request.)');
    process.exit(2);
  }
})();
