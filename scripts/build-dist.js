const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'public');
const dest = path.resolve(__dirname, '..', 'dist');

async function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const cur = path.join(dir, file);
    if (fs.lstatSync(cur).isDirectory()) {
      await rmDir(cur);
    } else {
      fs.unlinkSync(cur);
    }
  }
  fs.rmdirSync(dir);
}

function copyRecursive(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

(async function build(){
  try {
    console.log('Building dist from public...');
    await rmDir(dest);
    copyRecursive(src, dest);
    console.log('Built dist/ successfully.');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
})();
