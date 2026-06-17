// Decodes the INDEX_B64 constant in server.js to tools/index.work.html
// so the UI can be edited as plain HTML, never as base64.
// Usage: node tools/extract-index.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const m = server.match(/const INDEX_B64="([A-Za-z0-9+/=]*)"/);
if (!m) {
  console.error('Could not find INDEX_B64 constant in server.js');
  process.exit(1);
}
const html = Buffer.from(m[1], 'base64').toString('utf8');
const out = path.join(__dirname, 'index.work.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`Decoded INDEX_B64 -> ${out}`);
console.log(`Base64 length: ${m[1].length}, HTML length: ${html.length}`);
