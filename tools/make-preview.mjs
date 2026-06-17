// Builds a standalone, auth-free preview of the dashboard for local testing:
// decodes SNAPSHOT_B64 from server.js and injects it into the working HTML at /*__DATA__*/,
// exactly the way the live server does. Output: tools/preview.test.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.work.html'), 'utf8');

const sm = server.match(/const SNAPSHOT_B64="([A-Za-z0-9+/=]*)"/);
if (!sm) { console.error('SNAPSHOT_B64 not found'); process.exit(1); }
const snapshot = Buffer.from(sm[1], 'base64').toString('utf8'); // already JSON

const inject = 'const DATA=' + snapshot + ';window.__STALE__=false;';
const out = html.replace('/*__DATA__*/', inject);
const outPath = path.join(__dirname, 'preview.test.html');
fs.writeFileSync(outPath, out, 'utf8');
console.log(`Wrote ${outPath} (${out.length} chars, snapshot ${snapshot.length} chars)`);
