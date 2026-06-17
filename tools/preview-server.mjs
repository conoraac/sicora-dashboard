// Minimal static server for local chart-fix verification. Serves tools/preview.test.html at /.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4599;
const file = path.join(__dirname, 'preview.test.html');

http.createServer((req, res) => {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(500); res.end('preview.test.html missing — run node tools/make-preview.mjs'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Preview server on http://localhost:${PORT}`));
