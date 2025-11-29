const { execFile } = require('child_process');
const path = require('path');
const cwd = __dirname + '\\..';
const relScript = path.join('scripts', 'test-insta-run.mjs');
execFile(process.execPath, [relScript, 'DQMWGqYjHXJ'], { cwd }, (err, stdout, stderr) => {
  console.log('ERR', err && err.message);
  console.log('STDOUT', stdout);
  console.log('STDERR', stderr);
});
