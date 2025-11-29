#!/usr/bin/env node
import instagram from './instagram-service-standalone.mjs';

(async () => {
  try {
    const res = await instagram({ postId: process.argv[2] || 'DQMWGqYjHXJ' });
    console.log('RESULT:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();
