// embed.mjs — keep the dashboard's embedded frontend + snapshot in sync with the source files.
//
//   node embed.mjs extract   decode server.js's INDEX_B64 / SNAPSHOT_B64 into index.html + snapshot.json
//                            (run this FIRST, so the editable source matches what is deployed)
//   node embed.mjs           encode index.html + snapshot.json back into server.js
//
// Edit index.html (the UI) or snapshot.json (cold-start fallback data), then run `node embed.mjs`
// and redeploy. Never hand-edit the base64 strings inside server.js.
import fs from 'fs';
const SERVER = 'server.js', INDEX = 'index.html', SNAP = 'snapshot.json';
const mode = process.argv[2];
let s = fs.readFileSync(SERVER, 'utf8');
const getConst = name => { const m = s.match(new RegExp('const ' + name + '="([^"]*)";')); return m ? m[1] : null; };

if (mode === 'extract') {
  const ib = getConst('INDEX_B64'), sb = getConst('SNAPSHOT_B64');
  if (ib) fs.writeFileSync(INDEX, Buffer.from(ib, 'base64').toString('utf8'));
  if (sb) fs.writeFileSync(SNAP, Buffer.from(sb, 'base64').toString('utf8'));
  console.log('Extracted ' + (ib ? 'index.html ' : '') + (sb ? 'snapshot.json' : ''));
} else {
  const html = fs.readFileSync(INDEX, 'utf8');
  if (html.indexOf('/*__DATA__*/') < 0) throw new Error('index.html is missing the /*__DATA__*/ placeholder; aborting so the live data injection is not broken.');
  const snapRaw = fs.readFileSync(SNAP, 'utf8'); JSON.parse(snapRaw); // validate JSON before embedding
  const ib = Buffer.from(html, 'utf8').toString('base64');
  const sb = Buffer.from(snapRaw, 'utf8').toString('base64');
  s = s.replace(/const INDEX_B64="[^"]*";/, () => 'const INDEX_B64="' + ib + '";');
  s = s.replace(/const SNAPSHOT_B64="[^"]*";/, () => 'const SNAPSHOT_B64="' + sb + '";');
  fs.writeFileSync(SERVER, s);
  console.log('Embedded index.html (' + ib.length + ' b64 chars) + snapshot.json (' + sb.length + ') into server.js');
}
