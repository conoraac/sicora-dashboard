// Syntax-checks the inline (non-src) <script> blocks in tools/index.work.html
// without executing them, by compiling each with new Function().
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'index.work.html'), 'utf8');

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, failures = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  const body = m[2] || '';
  i++;
  if (/\bsrc\s*=/.test(attrs)) { console.log(`script #${i}: external (skipped)`); continue; }
  if (!body.trim()) { console.log(`script #${i}: empty (skipped)`); continue; }
  try {
    new Function(body); // compile-only; does not run
    console.log(`script #${i}: OK (${body.length} chars)`);
  } catch (e) {
    failures++;
    console.error(`script #${i}: SYNTAX ERROR -> ${e.message}`);
  }
}
console.log(failures ? `\nFAILED: ${failures} script(s) with syntax errors` : '\nAll inline scripts parsed OK');
process.exit(failures ? 1 : 0);
