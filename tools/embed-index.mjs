// Re-encodes tools/index.work.html into the INDEX_B64 constant in server.js.
// Never hand-edit the base64; edit index.work.html then run this.
// Usage: node tools/embed-index.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const serverPath = path.join(ROOT, 'server.js');
const htmlPath = path.join(__dirname, 'index.work.html');

const server = fs.readFileSync(serverPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

if (!/const INDEX_B64="([A-Za-z0-9+/=]*)"/.test(server)) {
  console.error('Could not find INDEX_B64 constant in server.js');
  process.exit(1);
}

// Sanity: the live data injection placeholder must survive.
if (!html.includes('/*__DATA__*/')) {
  console.error('Refusing to embed: /*__DATA__*/ placeholder missing from HTML.');
  process.exit(1);
}

const b64 = Buffer.from(html, 'utf8').toString('base64');
const updated = server.replace(/const INDEX_B64="[A-Za-z0-9+/=]*"/, `const INDEX_B64="${b64}"`);
fs.writeFileSync(serverPath, updated, 'utf8');

// Verify round-trip.
const check = Buffer.from(b64, 'base64').toString('utf8');
console.log(`Re-embedded INDEX_B64 (${b64.length} base64 chars, ${html.length} HTML chars).`);
console.log(`Round-trip OK: ${check === html}`);
