const http = require('http');
const data = JSON.stringify({ urls: ['https://www.instagram.com/reel/DQMWGqYjHXJ'], message: 'Sample video' });
const req = http.request({ hostname: `${process.env.API_DOMAIN || 'localhost'}`, port: 3000, path: '/api/post-instagram', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
  res.setEncoding('utf8');
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    try { console.log('BODY', JSON.parse(body)); } catch (e) { console.log('BODY', body); }
  });
});
req.on('error', e => console.error('ERR', e));
req.write(data);
req.end();
