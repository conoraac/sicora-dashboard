// Sicora Consulting Performance Dashboard — backend
// One branded page with LIVE data injected (GA4 + Google Ads + Search Console + GoHighLevel),
// AI analyst notes/Q&A proxied server-side. Cloned from the BBZ dashboard; see SICORA-BUILD-BRIEF.md.
// Runs on Railway (npm start).
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { buildEmail } from './ghl-integration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;            // required for analyst notes / Q&A
const WINDSOR_KEY   = process.env.WINDSOR_API_KEY;              // optional: enables live data
const GA4_ACCOUNT   = process.env.GA4_ACCOUNT || '251028744';            // Sicora GA4 property id (not a valid GA4 dimension - reference only)
const GA4_NAME      = process.env.GA4_ACCOUNT_NAME || 'Sicora GA4';      // Sicora GA4 'Account Name' - the only GA4 identifier Windsor exposes as a filterable field
const GADS_ACCOUNT  = process.env.GADS_ACCOUNT || '470-137-4429';        // Sicora Consulting Google Ads
const GSC_ACCOUNT   = process.env.GSC_ACCOUNT || 'https://sicoraconsulting.com/'; // Sicora Search Console — URL-prefix property (use verbatim, do NOT strip)
const GHL_ACCOUNT   = process.env.GHL_ACCOUNT || 'h0Iu6JkLutDW09474iZ5'; // Sicora GoHighLevel location id
const MODEL         = process.env.MODEL || 'claude-sonnet-4-6';

// Per-user access. Passwords come ONLY from env vars (no hardcoded fallbacks — fails closed,
// same as BBZ build 50). Keys always present so AUTH_ENABLED stays true; a user whose PW_* is
// unset simply cannot sign in. NOTE: confirm/replace the Sicora client email below.
const USERS = {
  'conor@astoriaadvertising.co': process.env.PW_CONOR,
  'client@sicoraconsulting.com': process.env.PW_SICORA,   // TODO: replace with the real Sicora login email
};
const AUTH_ENABLED = true; // always gate this client report
const AUTH_SALT = process.env.AUTH_SALT || 'sicora-dash-v1';
const BUILD = 1; // bump every deploy; surfaced in the footer and /api/health

const LOGIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sicora Consulting — Performance Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#2c3f6b;font-family:'Hanken Grotesk',Arial,sans-serif;color:#fff;padding:24px}
.box{width:100%;max-width:360px;text-align:center}
.mark{margin-bottom:34px;line-height:1}
.mark .w{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:40px;letter-spacing:.04em}
.mark .rule{height:1px;background:#f58459;margin:7px auto 6px;width:140px}
.mark .sub{font-size:8.5px;letter-spacing:.26em;color:#cfd2d6}
h1{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:19px;margin-bottom:6px}
p.sub2{font-size:12px;color:#8a8d92;letter-spacing:.03em;margin-bottom:24px}
input{width:100%;font-family:inherit;font-size:14px;color:#fff;background:#243154;border:1px solid #3a4a6e;border-radius:8px;padding:12px 14px;text-align:center;letter-spacing:.04em}
input:focus{outline:none;border-color:#f58459}
button{width:100%;margin-top:12px;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1a1208;background:#f58459;border:0;border-radius:8px;padding:12px;cursor:pointer}
button:hover{background:#cdb068}button:disabled{opacity:.6;cursor:default}
.err{min-height:18px;margin-top:12px;font-size:12px;color:#cf6b5f}
.foot{margin-top:30px;font-size:8px;letter-spacing:.28em;color:#54565b;text-transform:uppercase}
</style></head>
<body><div class="box">
<div class="mark"><div class="w">SICORA</div><div class="rule"></div><div class="sub">CONSULTING</div></div>
<h1>Performance Dashboard</h1><p class="sub2">Sign in to view this report.</p>
<input id="em" type="email" placeholder="Email" autofocus autocomplete="username" style="margin-bottom:10px">
<input id="pw" type="password" placeholder="Password" autocomplete="current-password">
<button id="go">View Report</button>
<div class="err" id="err"></div>
<div class="foot">Astoria Advertising Company</div>
</div>
<script>
var em=document.getElementById('em'),pw=document.getElementById('pw'),go=document.getElementById('go'),err=document.getElementById('err');
function submit(){err.textContent='';go.disabled=true;go.textContent='Checking...';
 fetch('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em.value,password:pw.value})})
 .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
 .then(function(x){if(x.ok&&x.j&&x.j.ok){location.href='/';}else{err.textContent=(x.j&&x.j.error)||'Incorrect email or password.';go.disabled=false;go.textContent='View Report';pw.value='';pw.focus();}})
 .catch(function(){err.textContent='Something went wrong. Please try again.';go.disabled=false;go.textContent='View Report';});}
go.addEventListener('click',submit);
em.addEventListener('keydown',function(e){if(e.key==='Enter')submit();});
pw.addEventListener('keydown',function(e){if(e.key==='Enter')submit();});
</script></body></html>`;

// ----------------------------------------------------------------------------
// Windsor.ai REST pull. Windsor returns EVERY connected account by default, so we
// scope every pull explicitly: server-side via the `filter` param AND client-side by
// dropping rows whose account field != ours. (Search Console + GA4 ignore the server
// filter, so those pass serverFilter:false and rely on the code-filter.)
// ----------------------------------------------------------------------------
async function windsor(connector, account, fields, from, to, opts = {}) {
  const acctField = opts.acctField || 'account_id';
  const useServerFilter = opts.serverFilter !== false;
  const flds = (account && !fields.includes(acctField)) ? [acctField, ...fields] : fields;
  const params = new URLSearchParams();
  params.set('api_key', WINDSOR_KEY);
  params.set('date_from', from);
  params.set('date_to', to);
  params.set('fields', flds.join(','));
  params.set('_renderer', 'json');
  if (account && useServerFilter) params.set('filter', JSON.stringify([[acctField, 'eq', account]]));
  if (opts.date_filters) params.set('date_filters', JSON.stringify(opts.date_filters));
  const url = `https://connectors.windsor.ai/${connector}?` + params.toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let r;
  try { r = await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(connector + ' ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  let rows = j.data || j;
  if (Array.isArray(rows) && account) rows = rows.filter(x => String(x[acctField]) === String(account));
  return rows;
}

const FROM = '2024-06-01';
const TO   = () => new Date().toISOString().slice(0, 10);
const normYM = s => String(s).includes('|')
  ? String(s).split('|')[0] + String(s).split('|')[1].padStart(2, '0')
  : String(s);

const BOT_REG  = new Set(['Gansu','Vojvodina','Central Visayas','Punjab','Iowa','England','Washington','Wyoming']);
const BOT_CITY = new Set(['Lanzhou','Singapore','Santa Clara','Moses Lake','Mission Viejo','Ashburn','Dallas','North Haledon']);

function geo(rows, key, bots, topn) {
  const tot = {};
  for (const r of rows) { const n = r[key], s = +r.sessions; if (!n || bots.has(n) || !s) continue; tot[n] = (tot[n]||0)+s; }
  const top = Object.entries(tot).sort((a,b)=>b[1]-a[1]).slice(0, topn).map(x=>x[0]);
  const map = {};
  for (const r of rows) {
    const n = r[key], s = +r.sessions, k = +r.conversions || 0; if (!n || bots.has(n) || !s) continue;
    const kk = top.includes(n) ? n : 'Other', ym = normYM(r.year_month);
    const d = (map[ym] = map[ym] || {}), cur = (d[kk] = d[kk] || [0,0]); cur[0]+=s; cur[1]+=k;
  }
  return { names: [...top, 'Other'], map };
}

// ---- GA4 (scope by account_name; account_id is not a valid GA4 dimension) ----
async function buildGA4() {
  const to = TO();
  const Q = (f) => windsor('googleanalytics4', GA4_NAME, f, FROM, to, { acctField: 'account_name', serverFilter: false }).catch(e => { console.error('GA4 query:', e.message); return []; });
  const ch   = await Q(['year_month','session_default_channel_group','sessions','totalusers','screen_page_views','event_count','conversions']);
  const tot  = await Q(['year_month','sessions','totalusers','screen_page_views','event_count','conversions']);
  const reg  = await Q(['year_month','region','sessions','conversions']);
  const city = await Q(['year_month','city','sessions','conversions']);
  const chm = {}, chans = new Set(), months = new Set();
  for (const r of ch) {
    const ym = normYM(r.year_month), c = r.session_default_channel_group;
    if (!ym || !c || +r.sessions < 5) continue;
    chans.add(c); months.add(ym);
    (chm[ym] = chm[ym] || {})[c] = [+r.sessions, +r.totalusers, +r.screen_page_views, +r.event_count, +r.conversions];
  }
  const totals = {};
  for (const r of (tot || [])) { const ym = normYM(r.year_month); if (!ym) continue; totals[ym] = [+r.sessions||0, +r.totalusers||0, +r.screen_page_views||0, +r.event_count||0, +r.conversions||0]; }
  const R = geo(reg, 'region', BOT_REG, 8), Y = geo(city, 'city', BOT_CITY, 9);
  const monthsArr = [...months].sort();
  const nowYM = new Date().toISOString().slice(0,7).replace('-','');
  const complete = monthsArr.filter(m => m < nowYM);
  const current = complete.length ? complete[complete.length-1] : monthsArr[monthsArr.length-1];
  return { channels: [...chans].sort(), months: monthsArr, chm, totals,
           regNames: R.names, reg: R.map, cityNames: Y.names, city: Y.map, current };
}

// ---- Google Ads ----
function buildPaid(rows, valFields) {
  const data = {}, camps = [], months = new Set();
  for (const r of rows) {
    const ym = normYM(r.year_month), camp = r.campaign; if (!ym || !camp) continue;
    months.add(ym); if (!camps.includes(camp)) camps.push(camp);
    const vals = valFields.map(f => +r[f] || 0);
    (data[ym] = data[ym] || {})[camp] = vals;
  }
  return { months: [...months].sort(), campaigns: camps, data };
}
function cleanConvName(n){ n=String(n||''); const m=n.match(/\)\s*(.+)$/); let t=(m?m[1]:n).trim(); t=t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); return t||'Other'; }
async function buildGadsConv(){
  let rows; try{ rows = await windsor('google_ads', GADS_ACCOUNT, ['year_month','conversion_action_name','conversions'], FROM, TO()); }catch{ return { months:[], byMonth:{} }; }
  const byMonth={}, months=new Set();
  for(const r of (rows||[])){ const ym=normYM(r.year_month); if(!ym) continue; months.add(ym);
    const name=cleanConvName(r.conversion_action_name); const m=byMonth[ym]||(byMonth[ym]={}); m[name]=(m[name]||0)+(+r.conversions||0); }
  return { months:[...months].sort(), byMonth };
}
async function buildGads() {
  const base = buildPaid(
    await windsor('google_ads', GADS_ACCOUNT, ['year_month','campaign','clicks','impressions','cost','conversions'], FROM, TO()),
    ['clicks','impressions','cost','conversions']);
  base.conv = await buildGadsConv().catch(() => ({ months:[], byMonth:{} }));
  return base;
}

// ---- Search Console ----
async function buildGSC() {
  const d = new Date(); d.setMonth(d.getMonth() - 15);
  const from = d.toISOString().slice(0, 10);
  const data = {}, months = new Set();
  try {
    const rows = await windsor('searchconsole', GSC_ACCOUNT, ['year_month','clicks','impressions','position'], from, TO(), { serverFilter: false });
    if (Array.isArray(rows)) for (const r of rows) {
      const ym = normYM(r.year_month); if (!ym) continue;
      months.add(ym);
      data[ym] = [+r.clicks || 0, +r.impressions || 0, +r.position || 0];
    }
  } catch (e) { console.error('GSC totals:', e.message); }
  const out = { months: [...months].sort(), data };
  try { out.queries = await buildGSCQueries(); } catch (e) { console.error('GSC queries:', e.message); out.queries = {}; }
  if (!out.months.length && !Object.keys(out.queries).length) out.empty = true;
  return out;
}
async function buildGSCQueries() {
  const N = 16, BATCH = 4, now = new Date(), out = {};
  const specs = [];
  for (let i = 0; i < N; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    specs.push({
      from: d.toISOString().slice(0, 10),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10),
      ym: ('' + d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0'),
    });
  }
  for (let i = 0; i < specs.length; i += BATCH) {
    const slice = specs.slice(i, i + BATCH);
    const res = await Promise.all(slice.map(s =>
      windsor('searchconsole', GSC_ACCOUNT, ['account_id','query','clicks','impressions','position'], s.from, s.end, { serverFilter: false })
        .then(rows => ({ ym: s.ym, rows })).catch(() => ({ ym: s.ym, rows: [] }))
    ));
    for (const { ym, rows } of res) {
      if (!Array.isArray(rows) || !rows.length) continue;
      const Q = {};
      for (const r of rows) {
        const q = r.query; if (!q) continue;
        const v = Q[q] || (Q[q] = [0, 0, 0]);
        v[0] += +r.clicks || 0; v[1] += +r.impressions || 0; v[2] = +r.position || v[2];
      }
      out[ym] = Q;
    }
  }
  return out;
}

// ---- GoHighLevel (the centerpiece) ----
// contact_source == form/source label; contact_original_source == marketing channel.
// We pull contacts, opportunities, pipelines, transactions and orders, then build a
// per-contact journey map so the frontend can multi-select forms and roll up the journey.
const GHL_NONFORM = new Set(['HubSpot Migration', 'Test', 'hubspot migration', 'test']);
const ghl = (fields, opts = {}) => windsor('gohighlevel', GHL_ACCOUNT, fields, FROM, TO(), opts).catch(e => { console.error('GHL', e.message); return []; });
const won = s => /won/i.test(String(s || ''));
const succeeded = s => /succ|paid|complete|win/i.test(String(s || ''));

async function buildGHL() {
  // Sequential to respect Windsor per-connector rate limits.
  const contacts = await ghl(['contact_id', 'contact_source', 'contact_original_source', 'contact_original_source_detail_1', 'year_month']);
  const pipesRaw = await ghl(['pipeline_id', 'pipeline_name', 'pipeline_stages']);
  const opps     = await ghl(['opportunity_contact_id', 'opportunity_pipeline_id', 'opportunity_pipeline_stage_id', 'opportunity_status', 'opportunity_monetary_value']);
  const txns     = await ghl(['transaction_contact_id', 'transaction_amount', 'transaction_status']);
  const orders   = await ghl(['order_contact_id', 'order_amount', 'order_recurring_products', 'order_status']);

  // Pipelines: id -> {name, stages: {stageId: {name, position}}}
  const pipes = {};
  for (const p of (pipesRaw || [])) {
    if (!p.pipeline_id) continue;
    const stages = {};
    let st = p.pipeline_stages;
    try { if (typeof st === 'string') st = JSON.parse(st); } catch { st = []; }
    for (const s of (Array.isArray(st) ? st : [])) stages[s.id] = { name: s.name, position: s.position };
    pipes[p.pipeline_id] = { id: p.pipeline_id, name: p.pipeline_name || p.pipeline_id, stages };
  }

  // Transactions / orders aggregated per contact.
  const txnByContact = {};
  for (const t of (txns || [])) {
    const id = t.transaction_contact_id; if (!id) continue;
    const a = txnByContact[id] || (txnByContact[id] = { n: 0, val: 0 });
    if (succeeded(t.transaction_status) || t.transaction_status == null) { a.n++; a.val += +t.transaction_amount || 0; }
  }
  const orderByContact = {};
  for (const o of (orders || [])) {
    const id = o.order_contact_id; if (!id) continue;
    const a = orderByContact[id] || (orderByContact[id] = { n: 0, val: 0, recurring: false });
    a.n++; a.val += +o.order_amount || 0; if ((+o.order_recurring_products || 0) > 0) a.recurring = true;
  }

  // Opportunity (latest seen) per contact + pipeline/stage funnel counts.
  const oppByContact = {};
  const funnel = {}; // pipelineId -> {stageId: {n, value}}
  let openValue = 0, wonValue = 0, wonCount = 0, lostCount = 0, openCount = 0;
  for (const o of (opps || [])) {
    const id = o.opportunity_contact_id;
    const pid = o.opportunity_pipeline_id, sid = o.opportunity_pipeline_stage_id;
    const val = +o.opportunity_monetary_value || 0, status = o.opportunity_status;
    if (pid) {
      const f = funnel[pid] || (funnel[pid] = {});
      const c = f[sid] || (f[sid] = { n: 0, value: 0 });
      c.n++; c.value += val;
    }
    if (won(status)) { wonValue += val; wonCount++; }
    else if (/lost/i.test(String(status || ''))) lostCount++;
    else { openValue += val; openCount++; }
    if (id) oppByContact[id] = {
      pipeline: pid && pipes[pid] ? pipes[pid].name : null,
      stage: pid && pipes[pid] && pipes[pid].stages[sid] ? pipes[pid].stages[sid].name : null,
      status, value: val,
    };
  }

  // Per-contact journey + form/source aggregates.
  const months = new Set();
  const formAgg = {};      // formName -> {total, channels:{}}
  const byMonth = {};      // ym -> {formName: count}
  const sources = {};      // channel -> count
  const contactsOut = [];  // capped journey rows for the client multi-select + journey
  let formFills = 0;
  for (const c of (contacts || [])) {
    const id = c.contact_id;
    const form = c.contact_source || null;
    const chan = c.contact_original_source || null;
    const ym = normYM(c.year_month);
    const isForm = form && !GHL_NONFORM.has(form);
    if (ym && ym !== 'null' && ym !== 'undefined') months.add(ym);
    if (chan) sources[chan] = (sources[chan] || 0) + 1;
    if (isForm) {
      formFills++;
      const fa = formAgg[form] || (formAgg[form] = { total: 0, channels: {} });
      fa.total++;
      const ck = chan || 'Direct/Form';
      fa.channels[ck] = (fa.channels[ck] || 0) + 1;
      if (ym) { const m = byMonth[ym] || (byMonth[ym] = {}); m[form] = (m[form] || 0) + 1; }
    }
    const txn = id ? txnByContact[id] : null;
    const ord = id ? orderByContact[id] : null;
    const opp = id ? oppByContact[id] : null;
    contactsOut.push({
      id, form: form || '(none)', channel: chan || null,
      detail: c.contact_original_source_detail_1 || null, ym: ym || null,
      isForm: !!isForm,
      txn: !!(txn && txn.n) || !!(ord && ord.n),
      txnVal: ((txn && txn.val) || 0) + ((ord && ord.val) || 0),
      recurring: !!(ord && ord.recurring),
      pipeline: opp ? opp.pipeline : null,
      stage: opp ? opp.stage : null,
      oppStatus: opp ? opp.status : null,
    });
  }

  // Forms list sorted by volume.
  const forms = Object.entries(formAgg).map(([name, v]) => ({ name, total: v.total, channels: v.channels }))
    .sort((a, b) => b.total - a.total);

  // Pipeline funnel shaped for the frontend (ordered stages).
  const pipelines = Object.values(pipes).map(p => {
    const stages = Object.entries(p.stages).map(([id, s]) => ({ id, name: s.name, position: s.position }))
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const counts = funnel[p.id] || {};
    return { id: p.id, name: p.name, stages: stages.map(s => ({ name: s.name, n: (counts[s.id] || {}).n || 0, value: (counts[s.id] || {}).value || 0 })) };
  });

  // Email engagement from the direct GHL API (or snapshot fallback if no key).
  let email = null;
  try { email = await buildEmail({ contacts: contactsOut }); } catch (e) { console.error('GHL email:', e.message); email = null; }

  // Cap the per-contact array so the page stays light; keep the most recent.
  const CAP = 4000;
  const capped = contactsOut.length > CAP ? contactsOut.slice(-CAP) : contactsOut;

  return {
    months: [...months].sort(),
    forms, byMonth, sources,
    pipelines,
    summary: { formFills, totalContacts: contactsOut.length, openValue, wonValue, wonCount, lostCount, openCount },
    contacts: capped,
    contactsCapped: contactsOut.length > CAP ? CAP : 0,
    email,
  };
}

// ---- snapshot (cold-start fallback; replaced at deploy via embed.mjs) ----
const SNAPSHOT_B64="ewogICJjaGFubmVscyI6IFsiRGlyZWN0IiwgIk9yZ2FuaWMgU2VhcmNoIiwgIlBhaWQgU2VhcmNoIiwgIlJlZmVycmFsIiwgIkVtYWlsIiwgIk9yZ2FuaWMgU29jaWFsIiwgIlBhaWQgT3RoZXIiLCAiQ3Jvc3MtbmV0d29yayIsICJVbmFzc2lnbmVkIl0sCiAgIm1vbnRocyI6IFsiMjAyNjAxIiwgIjIwMjYwMiIsICIyMDI2MDMiLCAiMjAyNjA0IiwgIjIwMjYwNSJdLAogICJjdXJyZW50IjogIjIwMjYwNSIsCiAgImNobSI6IHsKICAgICIyMDI2MDEiOiB7IkRpcmVjdCI6IFsyOTgwLCAyODIwLCA3MTAwLCAxODIwMCwgMzFdLCAiT3JnYW5pYyBTZWFyY2giOiBbMTA0MCwgODAwLCAyNjAwLCA2MTAwLCAyMl0sICJQYWlkIFNlYXJjaCI6IFs3NjAsIDY2MCwgMTcwMCwgNDIwMCwgMjRdLCAiUmVmZXJyYWwiOiBbODAsIDYwLCAxOTAsIDQyMCwgMl19LAogICAgIjIwMjYwMiI6IHsiRGlyZWN0IjogWzMxMjAsIDI5NjAsIDc0MDAsIDE5MTAwLCAzM10sICJPcmdhbmljIFNlYXJjaCI6IFsxMDkwLCA4NDAsIDI3MDAsIDYzMDAsIDI0XSwgIlBhaWQgU2VhcmNoIjogWzgwMCwgNjkwLCAxODAwLCA0NDAwLCAyNl0sICJSZWZlcnJhbCI6IFs4NSwgNjQsIDIwMCwgNDQwLCAyXX0sCiAgICAiMjAyNjAzIjogeyJEaXJlY3QiOiBbMzM3OCwgMzI0MywgODEwMCwgMjA4MDAsIDM4XSwgIk9yZ2FuaWMgU2VhcmNoIjogWzExOTAsIDkxMSwgMjkwMCwgNjkwMCwgMjddLCAiUGFpZCBTZWFyY2giOiBbODY3LCA3NTMsIDE5NTAsIDQ3MDAsIDMxXSwgIlJlZmVycmFsIjogWzg5LCA1MywgMjEwLCA0NzAsIDNdLCAiVW5hc3NpZ25lZCI6IFsxOTAsIDE5MCwgNDEwLCA5ODAsIDFdfSwKICAgICIyMDI2MDQiOiB7IkRpcmVjdCI6IFs2NjIsIDU5NSwgMTcwMCwgNDEwMCwgMTJdLCAiT3JnYW5pYyBTZWFyY2giOiBbMTExOCwgNzg3LCAyODAwLCA2NzAwLCAyNV0sICJQYWlkIFNlYXJjaCI6IFs4MDksIDcwNCwgMTg1MCwgNDUwMCwgMjldLCAiUmVmZXJyYWwiOiBbOTksIDY5LCAyMzAsIDUxMCwgM119LAogICAgIjIwMjYwNSI6IHsiRGlyZWN0IjogWzcwMCwgNjM0LCAxNzUwLCA0MjAwLCAxNF0sICJPcmdhbmljIFNlYXJjaCI6IFsxMDkwLCA3ODEsIDI3NTAsIDY2MDAsIDI0XSwgIlBhaWQgU2VhcmNoIjogWzk4NywgODYzLCAyMTAwLCA1MDAwLCA0OV0sICJSZWZlcnJhbCI6IFs4MywgNjMsIDIwMCwgNDUwLCAyXX0KICB9LAogICJyZWdOYW1lcyI6IFsiQ2FsaWZvcm5pYSIsICJOZXcgWW9yayIsICJUZXhhcyIsICJNaW5uZXNvdGEiLCAiT3RoZXIiXSwKICAicmVnIjogewogICAgIjIwMjYwNSI6IHsiQ2FsaWZvcm5pYSI6IFs1MjAsIDZdLCAiTmV3IFlvcmsiOiBbNDEwLCA1XSwgIlRleGFzIjogWzM2MCwgNF0sICJNaW5uZXNvdGEiOiBbMzAwLCA4XSwgIk90aGVyIjogWzEyNzAsIDI2XX0KICB9LAogICJjaXR5TmFtZXMiOiBbIk1pbm5lYXBvbGlzIiwgIkNoaWNhZ28iLCAiTmV3IFlvcmsiLCAiT3RoZXIiXSwKICAiY2l0eSI6IHsKICAgICIyMDI2MDUiOiB7Ik1pbm5lYXBvbGlzIjogWzI4MCwgN10sICJDaGljYWdvIjogWzE5MCwgM10sICJOZXcgWW9yayI6IFsxNzAsIDJdLCAiT3RoZXIiOiBbMjIyMCwgMzddfQogIH0sCiAgImdhZHMiOiB7CiAgICAibW9udGhzIjogWyIyMDI2MDMiLCAiMjAyNjA0IiwgIjIwMjYwNSJdLAogICAgImNhbXBhaWducyI6IFsiU2VhcmNoIC0gSW5zaWdodHMgRGlzY292ZXJ5IiwgIlNlYXJjaCAtIExlYWRlcnNoaXAgVHJhaW5pbmciLCAiUE1heCAtIEJyYW5kIl0sCiAgICAiZGF0YSI6IHsKICAgICAgIjIwMjYwMyI6IHsiU2VhcmNoIC0gSW5zaWdodHMgRGlzY292ZXJ5IjogWzUyMCwgOTgwMCwgMTg1MC41LCAxOF0sICJTZWFyY2ggLSBMZWFkZXJzaGlwIFRyYWluaW5nIjogWzI0MCwgNTIwMCwgOTgwLjIsIDhdLCAiUE1heCAtIEJyYW5kIjogWzg1LCAyMTAwLCAyNTguNzksIDNdfSwKICAgICAgIjIwMjYwNCI6IHsiU2VhcmNoIC0gSW5zaWdodHMgRGlzY292ZXJ5IjogWzQ3MCwgOTIwMCwgMTkyMC40LCAxN10sICJTZWFyY2ggLSBMZWFkZXJzaGlwIFRyYWluaW5nIjogWzIyMCwgNDkwMCwgMTAxMC41LCA5XSwgIlBNYXggLSBCcmFuZCI6IFs3NSwgMTk1MCwgMzAzLjgsIDNdfSwKICAgICAgIjIwMjYwNSI6IHsiU2VhcmNoIC0gSW5zaWdodHMgRGlzY292ZXJ5IjogWzYwMCwgMTA0MDAsIDIxNTAuMCwgMzBdLCAiU2VhcmNoIC0gTGVhZGVyc2hpcCBUcmFpbmluZyI6IFsyODAsIDU2MDAsIDExODAuMCwgMTRdLCAiUE1heCAtIEJyYW5kIjogWzkwLCAyMzAwLCAzMTcuMCwgNV19CiAgICB9LAogICAgImNvbnYiOiB7CiAgICAgICJtb250aHMiOiBbIjIwMjYwMyIsICIyMDI2MDQiLCAiMjAyNjA1Il0sCiAgICAgICJieU1vbnRoIjogewogICAgICAgICIyMDI2MDMiOiB7IkFzc2Vzc21lbnQgUHVyY2hhc2UiOiAxMiwgIkNvbnRhY3QgRm9ybSI6IDExLCAiUGhvbmUgQ2FsbCI6IDZ9LAogICAgICAgICIyMDI2MDQiOiB7IkFzc2Vzc21lbnQgUHVyY2hhc2UiOiAxMywgIkNvbnRhY3QgRm9ybSI6IDEwLCAiUGhvbmUgQ2FsbCI6IDZ9LAogICAgICAgICIyMDI2MDUiOiB7IkFzc2Vzc21lbnQgUHVyY2hhc2UiOiAyNCwgIkNvbnRhY3QgRm9ybSI6IDE2LCAiUGhvbmUgQ2FsbCI6IDl9CiAgICAgIH0KICAgIH0KICB9LAogICJnc2MiOiB7CiAgICAibW9udGhzIjogWyIyMDI2MDEiLCAiMjAyNjAyIiwgIjIwMjYwMyIsICIyMDI2MDQiLCAiMjAyNjA1Il0sCiAgICAiZGF0YSI6IHsKICAgICAgIjIwMjYwMSI6IFszOTAsIDQ0MjAwLCA5LjFdLAogICAgICAiMjAyNjAyIjogWzQwNSwgNDU4MDAsIDguOV0sCiAgICAgICIyMDI2MDMiOiBbNDIwLCA0NzYwMCwgOC43XSwKICAgICAgIjIwMjYwNCI6IFs0MjgsIDQ4OTAwLCA4LjZdLAogICAgICAiMjAyNjA1IjogWzQzNSwgNDk4MTYsIDguNTJdCiAgICB9LAogICAgInF1ZXJpZXMiOiB7CiAgICAgICIyMDI2MDUiOiB7CiAgICAgICAgImluc2lnaHRzIGRpc2NvdmVyeSI6IFsxMjAsIDg0MDAsIDQuMl0sCiAgICAgICAgImxlYWRlcnNoaXAgdHJhaW5pbmciOiBbNzgsIDYxMDAsIDcuMV0sCiAgICAgICAgImVtcGxveWVlIGVuZ2FnZW1lbnQiOiBbNTQsIDUyMDAsIDkuOF0sCiAgICAgICAgInNpY29yYSBjb25zdWx0aW5nIjogWzkyLCAxODAwLCAxLjRdLAogICAgICAgICJ0ZWFtIGVmZmVjdGl2ZW5lc3MgYXNzZXNzbWVudCI6IFszMSwgMzkwMCwgMTIuM10KICAgICAgfQogICAgfQogIH0sCiAgImdobCI6IHsKICAgICJtb250aHMiOiBbIjIwMjYwMSIsICIyMDI2MDIiLCAiMjAyNjAzIiwgIjIwMjYwNCIsICIyMDI2MDUiXSwKICAgICJmb3JtcyI6IFsKICAgICAgeyJuYW1lIjogIkNvbnRhY3QgVXMiLCAidG90YWwiOiA4NiwgImNoYW5uZWxzIjogeyJPUkdBTklDX1NFQVJDSCI6IDM0LCAiUEFJRF9TRUFSQ0giOiAyMiwgIkRJUkVDVF9UUkFGRklDIjogMjAsICJSRUZFUlJBTFMiOiAxMH19LAogICAgICB7Im5hbWUiOiAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCIsICJ0b3RhbCI6IDY0LCAiY2hhbm5lbHMiOiB7IlBBSURfU0VBUkNIIjogMzgsICJPUkdBTklDX1NFQVJDSCI6IDE0LCAiRElSRUNUX1RSQUZGSUMiOiAxMn19LAogICAgICB7Im5hbWUiOiAiUFBDIC0gSW5zaWdodHMgRGlzY292ZXJ5IExhbmRpbmcgUGFnZSIsICJ0b3RhbCI6IDUyLCAiY2hhbm5lbHMiOiB7IlBBSURfU0VBUkNIIjogNDksICJESVJFQ1RfVFJBRkZJQyI6IDN9fSwKICAgICAgeyJuYW1lIjogIm1lbWJlcnNoaXAiLCAidG90YWwiOiAyOCwgImNoYW5uZWxzIjogeyJESVJFQ1RfVFJBRkZJQyI6IDE2LCAiT1JHQU5JQ19TRUFSQ0giOiA4LCAiRU1BSUxfTUFSS0VUSU5HIjogNH19LAogICAgICB7Im5hbWUiOiAiQ2FsZW5kbHkiLCAidG90YWwiOiAxOSwgImNoYW5uZWxzIjogeyJESVJFQ1RfVFJBRkZJQyI6IDEyLCAiT1JHQU5JQ19TRUFSQ0giOiA3fX0KICAgIF0sCiAgICAiYnlNb250aCI6IHsKICAgICAgIjIwMjYwMSI6IHsiQ29udGFjdCBVcyI6IDE0LCAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCI6IDEwLCAiUFBDIC0gSW5zaWdodHMgRGlzY292ZXJ5IExhbmRpbmcgUGFnZSI6IDgsICJtZW1iZXJzaGlwIjogNSwgIkNhbGVuZGx5IjogM30sCiAgICAgICIyMDI2MDIiOiB7IkNvbnRhY3QgVXMiOiAxNiwgIjQgQ29sb3JzIG9mIEluc2lnaHRzIENvbnRhY3QiOiAxMiwgIlBQQyAtIEluc2lnaHRzIERpc2NvdmVyeSBMYW5kaW5nIFBhZ2UiOiA5LCAibWVtYmVyc2hpcCI6IDUsICJDYWxlbmRseSI6IDR9LAogICAgICAiMjAyNjAzIjogeyJDb250YWN0IFVzIjogMTgsICI0IENvbG9ycyBvZiBJbnNpZ2h0cyBDb250YWN0IjogMTMsICJQUEMgLSBJbnNpZ2h0cyBEaXNjb3ZlcnkgTGFuZGluZyBQYWdlIjogMTEsICJtZW1iZXJzaGlwIjogNiwgIkNhbGVuZGx5IjogNH0sCiAgICAgICIyMDI2MDQiOiB7IkNvbnRhY3QgVXMiOiAxOSwgIjQgQ29sb3JzIG9mIEluc2lnaHRzIENvbnRhY3QiOiAxNCwgIlBQQyAtIEluc2lnaHRzIERpc2NvdmVyeSBMYW5kaW5nIFBhZ2UiOiAxMiwgIm1lbWJlcnNoaXAiOiA2LCAiQ2FsZW5kbHkiOiA0fSwKICAgICAgIjIwMjYwNSI6IHsiQ29udGFjdCBVcyI6IDE5LCAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCI6IDE1LCAiUFBDIC0gSW5zaWdodHMgRGlzY292ZXJ5IExhbmRpbmcgUGFnZSI6IDEyLCAibWVtYmVyc2hpcCI6IDYsICJDYWxlbmRseSI6IDR9CiAgICB9LAogICAgInNvdXJjZXMiOiB7Ik9SR0FOSUNfU0VBUkNIIjogNzcsICJQQUlEX1NFQVJDSCI6IDEwOSwgIkRJUkVDVF9UUkFGRklDIjogNjMsICJSRUZFUlJBTFMiOiAyMCwgIkVNQUlMX01BUktFVElORyI6IDQsICJQQUlEX1NPQ0lBTCI6IDgsICJTT0NJQUxfTUVESUEiOiA2fSwKICAgICJwaXBlbGluZXMiOiBbCiAgICAgIHsiaWQiOiAiS2hSR25XWkFvbHlFYUpkdzJ4U2siLCAibmFtZSI6ICJQUEMgKyBTRU8iLCAic3RhZ2VzIjogWwogICAgICAgIHsibmFtZSI6ICJOZXcgTGVhZCIsICJuIjogNDIsICJ2YWx1ZSI6IDB9LAogICAgICAgIHsibmFtZSI6ICJJbml0aWFsIE91dHJlYWNoIFNlbnQiLCAibiI6IDI4LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiRGlzY292ZXJ5IENhbGwgU2NoZWR1bGVkIiwgIm4iOiAxOCwgInZhbHVlIjogNTQwMDB9LAogICAgICAgIHsibmFtZSI6ICJEaXNjb3ZlcnkgQ2FsbCBDb21wbGV0ZSIsICJuIjogMTIsICJ2YWx1ZSI6IDQ4MDAwfSwKICAgICAgICB7Im5hbWUiOiAiUHJvcG9zYWwgU2VudCIsICJuIjogOCwgInZhbHVlIjogNjQwMDB9LAogICAgICAgIHsibmFtZSI6ICJDb250cmFjdCBTZW50IiwgIm4iOiA0LCAidmFsdWUiOiAzODAwMH0sCiAgICAgICAgeyJuYW1lIjogIkNhbmNlbGxlZCIsICJuIjogMywgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIkNsb3NlZCAtIFdvbiIsICJuIjogOSwgInZhbHVlIjogOTYwMDB9LAogICAgICAgIHsibmFtZSI6ICJDbG9zZWQgLSBMb3N0IiwgIm4iOiAxNCwgInZhbHVlIjogMH0KICAgICAgXX0sCiAgICAgIHsiaWQiOiAibzdMU3hLZ1NZWkE4OVZLSHlETjkiLCAibmFtZSI6ICJSdWxlIG9mIDUiLCAic3RhZ2VzIjogWwogICAgICAgIHsibmFtZSI6ICJUb3VjaCAxIiwgIm4iOiAyMiwgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIlRvdWNoIDIiLCAibiI6IDE0LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiVG91Y2ggMyIsICJuIjogOSwgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIlJlc3BvbnNlIFJlY2VpdmVkIiwgIm4iOiA2LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiQ29udmVyc2F0aW9uIEFjdGl2ZSIsICJuIjogNSwgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIk1lZXRpbmcgU2NoZWR1bGVkIiwgIm4iOiA0LCAidmFsdWUiOiAyMjAwMH0sCiAgICAgICAgeyJuYW1lIjogIkNsb3NlZCAtIFdvbiIsICJuIjogMywgInZhbHVlIjogMjgwMDB9LAogICAgICAgIHsibmFtZSI6ICJDbG9zZWQgLSBMb3N0IiwgIm4iOiA3LCAidmFsdWUiOiAwfQogICAgICBdfSwKICAgICAgeyJpZCI6ICJDQWM0c0E5c2gxNnBzbXVaUkZJdyIsICJuYW1lIjogIlNlbGYgU2VydmljZSIsICJzdGFnZXMiOiBbCiAgICAgICAgeyJuYW1lIjogIk5ldyBMZWFkIiwgIm4iOiAzMSwgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIkFzc2Vzc21lbnQgZm9yIFB1cmNoYXNlIEVtYWlsIFNlbnQiLCAibiI6IDE5LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiQXNzZXNzbWVudCBQYXltZW50IE1hZGUiLCAibiI6IDE0LCAidmFsdWUiOiA0MjAwfSwKICAgICAgICB7Im5hbWUiOiAiQXNzZXNzbWVudCBJbiBQcm9ncmVzcyIsICJuIjogOSwgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIkFzc2Vzc21lbnQgQ29tcGxldGUiLCAibiI6IDcsICJ2YWx1ZSI6IDB9LAogICAgICAgIHsibmFtZSI6ICJVcHNlbGwgT3Bwb3J0dW5pdHkiLCAibiI6IDMsICJ2YWx1ZSI6IDkwMDB9LAogICAgICAgIHsibmFtZSI6ICJDbG9zZWQgLSBXb24iLCAibiI6IDUsICJ2YWx1ZSI6IDEyNTAwfSwKICAgICAgICB7Im5hbWUiOiAiQ2xvc2VkIC0gTG9zdCIsICJuIjogNCwgInZhbHVlIjogMH0KICAgICAgXX0KICAgIF0sCiAgICAic3VtbWFyeSI6IHsiZm9ybUZpbGxzIjogMjQ5LCAidG90YWxDb250YWN0cyI6IDMxMiwgIm9wZW5WYWx1ZSI6IDIzOTIwMCwgIndvblZhbHVlIjogMTM2NTAwLCAid29uQ291bnQiOiAxNywgImxvc3RDb3VudCI6IDI1LCAib3BlbkNvdW50IjogMTk4fSwKICAgICJjb250YWN0cyI6IFsKICAgICAgeyJpZCI6ICJjMSIsICJmb3JtIjogIkNvbnRhY3QgVXMiLCAiY2hhbm5lbCI6ICJPUkdBTklDX1NFQVJDSCIsICJkZXRhaWwiOiAic2ljb3JhY29uc3VsdGluZy5jb20vY29udGFjdCIsICJ5bSI6ICIyMDI2MDUiLCAiaXNGb3JtIjogdHJ1ZSwgInR4biI6IGZhbHNlLCAidHhuVmFsIjogMCwgInJlY3VycmluZyI6IGZhbHNlLCAicGlwZWxpbmUiOiAiUFBDICsgU0VPIiwgInN0YWdlIjogIkRpc2NvdmVyeSBDYWxsIFNjaGVkdWxlZCIsICJvcHBTdGF0dXMiOiAib3BlbiJ9LAogICAgICB7ImlkIjogImMyIiwgImZvcm0iOiAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCIsICJjaGFubmVsIjogIlBBSURfU0VBUkNIIiwgImRldGFpbCI6ICJBdXRvLXRhZ2dlZCBQUEMiLCAieW0iOiAiMjAyNjA1IiwgImlzRm9ybSI6IHRydWUsICJ0eG4iOiB0cnVlLCAidHhuVmFsIjogNDk1LCAicmVjdXJyaW5nIjogZmFsc2UsICJwaXBlbGluZSI6ICJTZWxmIFNlcnZpY2UiLCAic3RhZ2UiOiAiQXNzZXNzbWVudCBQYXltZW50IE1hZGUiLCAib3BwU3RhdHVzIjogIm9wZW4ifSwKICAgICAgeyJpZCI6ICJjMyIsICJmb3JtIjogIm1lbWJlcnNoaXAiLCAiY2hhbm5lbCI6ICJESVJFQ1RfVFJBRkZJQyIsICJkZXRhaWwiOiAic2ljb3JhY29uc3VsdGluZy5jb20vZW5nYWdlbWVudCIsICJ5bSI6ICIyMDI2MDUiLCAiaXNGb3JtIjogdHJ1ZSwgInR4biI6IHRydWUsICJ0eG5WYWwiOiAxMjAwLCAicmVjdXJyaW5nIjogdHJ1ZSwgInBpcGVsaW5lIjogIlNlbGYgU2VydmljZSIsICJzdGFnZSI6ICJDbG9zZWQgLSBXb24iLCAib3BwU3RhdHVzIjogIndvbiJ9LAogICAgICB7ImlkIjogImM0IiwgImZvcm0iOiAiUFBDIC0gSW5zaWdodHMgRGlzY292ZXJ5IExhbmRpbmcgUGFnZSIsICJjaGFubmVsIjogIlBBSURfU0VBUkNIIiwgImRldGFpbCI6ICJsZ19zZWFyY2giLCAieW0iOiAiMjAyNjA0IiwgImlzRm9ybSI6IHRydWUsICJ0eG4iOiBmYWxzZSwgInR4blZhbCI6IDAsICJyZWN1cnJpbmciOiBmYWxzZSwgInBpcGVsaW5lIjogIlBQQyArIFNFTyIsICJzdGFnZSI6ICJQcm9wb3NhbCBTZW50IiwgIm9wcFN0YXR1cyI6ICJvcGVuIn0sCiAgICAgIHsiaWQiOiAiYzUiLCAiZm9ybSI6ICJDb250YWN0IFVzIiwgImNoYW5uZWwiOiAiUEFJRF9TRUFSQ0giLCAiZGV0YWlsIjogIkF1dG8tdGFnZ2VkIFBQQyIsICJ5bSI6ICIyMDI2MDQiLCAiaXNGb3JtIjogdHJ1ZSwgInR4biI6IHRydWUsICJ0eG5WYWwiOiA4MDAwLCAicmVjdXJyaW5nIjogZmFsc2UsICJwaXBlbGluZSI6ICJQUEMgKyBTRU8iLCAic3RhZ2UiOiAiQ2xvc2VkIC0gV29uIiwgIm9wcFN0YXR1cyI6ICJ3b24ifSwKICAgICAgeyJpZCI6ICJjNiIsICJmb3JtIjogIm1lbWJlcnNoaXAiLCAiY2hhbm5lbCI6ICJFTUFJTF9NQVJLRVRJTkciLCAiZGV0YWlsIjogImhzX2VtYWlsIiwgInltIjogIjIwMjYwNSIsICJpc0Zvcm0iOiB0cnVlLCAidHhuIjogdHJ1ZSwgInR4blZhbCI6IDEyMDAsICJyZWN1cnJpbmciOiB0cnVlLCAicGlwZWxpbmUiOiAiU2VsZiBTZXJ2aWNlIiwgInN0YWdlIjogIlVwc2VsbCBPcHBvcnR1bml0eSIsICJvcHBTdGF0dXMiOiAib3BlbiJ9LAogICAgICB7ImlkIjogImM3IiwgImZvcm0iOiAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCIsICJjaGFubmVsIjogIk9SR0FOSUNfU0VBUkNIIiwgImRldGFpbCI6ICJzaWNvcmFjb25zdWx0aW5nLmNvbS80LWNvbG9ycy1vZi1pbnNpZ2h0cyIsICJ5bSI6ICIyMDI2MDMiLCAiaXNGb3JtIjogdHJ1ZSwgInR4biI6IGZhbHNlLCAidHhuVmFsIjogMCwgInJlY3VycmluZyI6IGZhbHNlLCAicGlwZWxpbmUiOiAiUnVsZSBvZiA1IiwgInN0YWdlIjogIk1lZXRpbmcgU2NoZWR1bGVkIiwgIm9wcFN0YXR1cyI6ICJvcGVuIn0KICAgIF0sCiAgICAiY29udGFjdHNDYXBwZWQiOiAwLAogICAgImVtYWlsIjogbnVsbAogIH0sCiAgImdlbmVyYXRlZEF0IjogIjIwMjYtMDYtMTdUMDA6MDA6MDAuMDAwWiIsCiAgImJ1aWxkIjogMQp9Cg==";
const SNAPSHOT = (() => { try { return JSON.parse(Buffer.from(SNAPSHOT_B64, 'base64').toString('utf8')); } catch { return { months: [], channels: [], chm: {}, totals: {}, gads: {}, gsc: {}, ghl: {} }; } })();

// ---- assembly + cache ----
let cache = { t: 0, data: null };
let inflight = null;
const isFresh = () => cache.data && Date.now() - cache.t < 600e3; // 10 min

const nonEmpty = v => v && (Array.isArray(v) ? v.length : (typeof v === 'object' ? Object.keys(v).length : true));

async function refresh() {
  const [ga4, gads, gsc, ghlData] = await Promise.all([
    buildGA4().catch(e => { console.error('GA4:', e.message); return null; }),
    buildGads().catch(e => { console.error('Gads:', e.message); return null; }),
    buildGSC().catch(e => { console.error('GSC:', e.message); return null; }),
    buildGHL().catch(e => { console.error('GHL:', e.message); return null; }),
  ]);
  // keep last-good live GA4 before falling back to the baked sample
  const base = (ga4 && Array.isArray(ga4.months) && ga4.months.length) ? ga4
    : ((cache.data && Array.isArray(cache.data.months) && cache.data.months.length) ? cache.data : SNAPSHOT);
  const bestOf = (name, val) => nonEmpty(val) ? val
    : ((cache.data && nonEmpty(cache.data[name])) ? cache.data[name] : (nonEmpty(SNAPSHOT[name]) ? SNAPSHOT[name] : val));
  const data = {
    ...base,
    gads: bestOf('gads', gads),
    gsc:  bestOf('gsc', gsc),
    ghl:  bestOf('ghl', ghlData),
    generatedAt: new Date().toISOString(),
    build: BUILD,
  };
  cache = { t: Date.now(), data };
  return data;
}

async function getData() {
  if (!WINDSOR_KEY) return SNAPSHOT;
  if (isFresh()) return cache.data;
  if (!inflight) inflight = refresh().catch(() => cache.data || SNAPSHOT).finally(() => { inflight = null; });
  return cache.data || await inflight;
}
function warm() { if (WINDSOR_KEY) refresh().catch(e => console.error('warm:', e.message)); }

// ---- auth (fail-closed, BBZ build-50 pattern) ----
function tokenFor(email) { return crypto.createHash('sha256').update('sicora::' + AUTH_SALT + '::' + email + '::' + USERS[email]).digest('hex'); }
const VALID_TOKENS = new Set(Object.keys(USERS).filter(e => USERS[e]).map(tokenFor)); // skip users with no PW_* set
function parseCookies(h) { const o = {}; (h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
function isAuthed(req) { if (!AUTH_ENABLED) return true; const c = parseCookies(req.headers.cookie).sicora_auth; return !!c && VALID_TOKENS.has(c); }

app.post('/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  const email = ((req.body && req.body.email) || '').trim().toLowerCase();
  const pw = ((req.body && req.body.password) || '').trim();
  if (USERS[email] && pw === USERS[email]) {
    res.set('Set-Cookie', `sicora_auth=${tokenFor(email)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect email or password.' });
});

// ---- public diagnostics ----
app.get('/api/health', (req, res) => {
  const d = cache.data;
  const mlen = s => (d && d[s] && Array.isArray(d[s].months)) ? d[s].months.length : 0;
  res.json({
    build: BUILD,
    passwordProtected: AUTH_ENABLED,
    users: Object.keys(USERS).filter(e => USERS[e]).length,
    liveDataReady: !!(d && Array.isArray(d.months) && d.months.length),
    windsorKeySet: !!WINDSOR_KEY,
    anthropicKeySet: !!ANTHROPIC_KEY,
    ghlApiKeySet: !!process.env.GHL_API_KEY,
    gscAccount: GSC_ACCOUNT,
    sections: {
      ga4Months: d && Array.isArray(d.months) ? d.months.length : 0,
      googleAdsMonths: mlen('gads'),
      searchConsoleMonths: mlen('gsc'),
      ghlForms: d && d.ghl && Array.isArray(d.ghl.forms) ? d.ghl.forms.length : 0,
      ghlFormFills: d && d.ghl && d.ghl.summary ? d.ghl.summary.formFills : 0,
      ghlContacts: d && d.ghl && d.ghl.summary ? d.ghl.summary.totalContacts : 0,
      ghlPipelines: d && d.ghl && Array.isArray(d.ghl.pipelines) ? d.ghl.pipelines.length : 0,
      ghlEmail: !!(d && d.ghl && d.ghl.email),
      dataAgeSeconds: cache.t ? Math.round((Date.now() - cache.t) / 1000) : null,
    },
  });
});

// ---- self-hosted Chart.js (public, above the gate) ----
let chartJsCache = null;
async function loadChartJs() {
  if (chartJsCache) return chartJsCache;
  const urls = ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
                'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'];
  for (const u of urls) {
    try { const r = await fetch(u); if (r.ok) { chartJsCache = await r.text(); return chartJsCache; } } catch {}
  }
  return null;
}
app.get('/vendor/chart.js', async (req, res) => {
  const js = await loadChartJs();
  if (!js) return res.status(502).send('// Chart.js unavailable');
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(js);
});

// ---- auth gate (everything below requires sign-in) ----
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in required.' });
  res.set('Content-Type', 'text/html; charset=utf-8').send(LOGIN_PAGE);
});

const INDEX_B64="PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgo8dGl0bGU+U2ljb3JhIENvbnN1bHRpbmcg4oCUIFBlcmZvcm1hbmNlIERhc2hib2FyZDwvdGl0bGU+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbSI+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nc3RhdGljLmNvbSIgY3Jvc3NvcmlnaW4+CjxsaW5rIGhyZWY9Imh0dHBzOi8vZm9udHMuZ29vZ2xlYXBpcy5jb20vY3NzMj9mYW1pbHk9RnJhdW5jZXM6b3Bzeix3Z2h0QDkuLjE0NCw1MDA7OS4uMTQ0LDYwMCZmYW1pbHk9SGFua2VuK0dyb3Rlc2s6d2dodEA0MDA7NTAwOzYwMDs3MDAmZGlzcGxheT1zd2FwIiByZWw9InN0eWxlc2hlZXQiPgo8c2NyaXB0IHNyYz0iL3ZlbmRvci9jaGFydC5qcyI+PC9zY3JpcHQ+CjxzdHlsZT4KOnJvb3R7CiAgLS1ibGFjazojMmMzZjZiOy0tY2hhcjojMjQzMTU0Oy0taW5rOiMyNDI2MmI7LS1tdXRlZDojOWE5ZWE2Oy0tZmFpbnQ6I2JjYmZjNTsKICAtLWdvbGQ6I2Y1ODQ1OTstLWdvbGQtbHQ6I2Y3OWE3NjstLXBhcGVyOiNmZmY7LS1iZzojZmZmZmZmOy0tbGluZTojZTZlYWYyOwogIC0tcG9zOiMzZjllNzQ7LS1uZWc6I2NmNmI1ZjstLWMxOiNmNTg0NTk7LS1jMjojNDA1YmE0Oy0tYzM6IzZlODI5ODstLWM0OiM4YTliN2U7LS1jNTojYjU4MzVmOy0tYzY6IzlhN2U4ZDstLWM3OiM4ODkzOWI7LS1jODojZDNjMDhmOy0tYzk6IzZmNjI4MDsKICAtLXNlcmlmOidGcmF1bmNlcycsR2VvcmdpYSxzZXJpZjstLXNhbnM6J0hhbmtlbiBHcm90ZXNrJywtYXBwbGUtc3lzdGVtLEFyaWFsLHNhbnMtc2VyaWY7Cn0KKnttYXJnaW46MDtwYWRkaW5nOjA7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e2JhY2tncm91bmQ6dmFyKC0tYmcpO2ZvbnQtZmFtaWx5OnZhcigtLXNhbnMpO2NvbG9yOnZhcigtLWluayk7Zm9udC1zaXplOjE0cHg7bGluZS1oZWlnaHQ6MS41fQoud3JhcHttYXgtd2lkdGg6MTE4MHB4O21hcmdpbjowIGF1dG87cGFkZGluZzoyMnB4IDIwcHggNjBweH0KaGVhZGVye2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LWVuZDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjtmbGV4LXdyYXA6d3JhcDtnYXA6MTZweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1saW5lKTtwYWRkaW5nLWJvdHRvbToxOHB4O21hcmdpbi1ib3R0b206OHB4fQouYnJhbmQgLnd7Zm9udC1mYW1pbHk6dmFyKC0tc2VyaWYpO2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MzBweDtsZXR0ZXItc3BhY2luZzouMDVlbTtjb2xvcjp2YXIoLS1pbmspfQouYnJhbmQgLnN1Yntmb250LXNpemU6OXB4O2xldHRlci1zcGFjaW5nOi4yNmVtO2NvbG9yOnZhcigtLW11dGVkKTttYXJnaW4tdG9wOjJweH0KLmJyYW5kIC5ydWxle2hlaWdodDoxcHg7YmFja2dyb3VuZDp2YXIoLS1nb2xkKTt3aWR0aDoxMjBweDttYXJnaW46NnB4IDAgNXB4fQouaG1ldGF7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1tdXRlZCl9Ci5obWV0YSAubGl2ZXtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O2NvbG9yOnZhcigtLXBvcyk7Zm9udC13ZWlnaHQ6NjAwfQouaG1ldGEgLmRvdHt3aWR0aDo3cHg7aGVpZ2h0OjdweDtib3JkZXItcmFkaXVzOjUwJTtiYWNrZ3JvdW5kOnZhcigtLXBvcyk7ZGlzcGxheTppbmxpbmUtYmxvY2t9Ci5jb250cm9sc3tkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7ZmxleC13cmFwOndyYXA7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbjoxOHB4IDAgNnB4fQouY29udHJvbHMgbGFiZWx7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouMDhlbX0Kc2VsZWN0e2ZvbnQtZmFtaWx5OmluaGVyaXQ7Zm9udC1zaXplOjEzcHg7Y29sb3I6dmFyKC0taW5rKTtiYWNrZ3JvdW5kOnZhcigtLXBhcGVyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6N3B4O3BhZGRpbmc6N3B4IDEwcHh9Ci5rcGlze2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxNTBweCwxZnIpKTtnYXA6MTJweDttYXJnaW46MTZweCAwIDhweH0KLmtwaXtiYWNrZ3JvdW5kOnZhcigtLXBhcGVyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE0cHggMTZweH0KLmtwaSAubGFie2ZvbnQtc2l6ZToxMC41cHg7bGV0dGVyLXNwYWNpbmc6LjA4ZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLW11dGVkKX0KLmtwaSAudmFse2ZvbnQtZmFtaWx5OnZhcigtLXNlcmlmKTtmb250LXNpemU6MjZweDtmb250LXdlaWdodDo2MDA7bWFyZ2luLXRvcDo0cHg7Y29sb3I6dmFyKC0taW5rKX0KLmtwaSAuY2hne2ZvbnQtc2l6ZToxMS41cHg7bWFyZ2luLXRvcDozcHh9Ci51cHtjb2xvcjp2YXIoLS1wb3MpfS5kb3due2NvbG9yOnZhcigtLW5lZyl9CnNlY3Rpb257YmFja2dyb3VuZDp2YXIoLS1wYXBlcik7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxOHB4IDIwcHg7bWFyZ2luLXRvcDoxOHB4fQouc2VjLWh7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmJhc2VsaW5lO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dhcDoxMnB4O21hcmdpbi1ib3R0b206NHB4fQpoMntmb250LWZhbWlseTp2YXIoLS1zZXJpZik7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxOHB4O2NvbG9yOnZhcigtLWluayl9Ci5zZWMtc3Vie2ZvbnQtc2l6ZToxMS41cHg7Y29sb3I6dmFyKC0tbXV0ZWQpfQouZ3JpZDJ7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxLjRmciAxZnI7Z2FwOjIwcHg7bWFyZ2luLXRvcDoxNHB4fQouZ3JpZDIuZXZlbntncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyIDFmcn0KQG1lZGlhKG1heC13aWR0aDo3NjBweCl7LmdyaWQyLC5ncmlkMi5ldmVue2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnJ9fQouY2hhcnRib3h7cG9zaXRpb246cmVsYXRpdmU7aGVpZ2h0OjI0MHB4fQouY2hhcnRib3guc217aGVpZ2h0OjIwMHB4fQouYW5vdGV7bWFyZ2luLXRvcDoxNHB4O2JvcmRlci10b3A6MXB4IGRhc2hlZCB2YXIoLS1saW5lKTtwYWRkaW5nLXRvcDoxMnB4fQouYW5vdGUtaHtmb250LXNpemU6MTAuNXB4O2xldHRlci1zcGFjaW5nOi4xZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLWdvbGQpO2ZvbnQtd2VpZ2h0OjcwMDtkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXJ9Ci5hbm90ZS1oIC5lZGhpbnR7Zm9udC1zaXplOjlweDtjb2xvcjp2YXIoLS1mYWludCk7bGV0dGVyLXNwYWNpbmc6LjA2ZW07Zm9udC13ZWlnaHQ6NTAwO3RleHQtdHJhbnNmb3JtOm5vbmV9Ci5hbm90ZS1ie2ZvbnQtc2l6ZToxM3B4O2NvbG9yOnZhcigtLWluayk7bWFyZ2luLXRvcDo2cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Ci5hbm90ZS1iW2RhdGEtZW1wdHlde2NvbG9yOnZhcigtLW11dGVkKTtmb250LXN0eWxlOml0YWxpY30KdGFibGV7d2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEyLjVweDttYXJnaW4tdG9wOjEwcHh9CnRoLHRke3RleHQtYWxpZ246bGVmdDtwYWRkaW5nOjdweCA4cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbGluZSl9CnRoe2ZvbnQtc2l6ZToxMHB4O2xldHRlci1zcGFjaW5nOi4wN2VtO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtjb2xvcjp2YXIoLS1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwfQp0ZC5udW0sdGgubnVte3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQouZXhlY3tiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgxODBkZWcsI2ZmZiwgI2ZiZjlmNCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1nb2xkLWx0KX0KLmV4ZWMgaDJ7Y29sb3I6dmFyKC0tZ29sZC1kaywjYTM4ODRhKX0KI2V4ZWNTdW17Zm9udC1zaXplOjE1cHg7bGluZS1oZWlnaHQ6MS42O2NvbG9yOnZhcigtLWluayk7d2hpdGUtc3BhY2U6cHJlLXdyYXB9CiNleGVjU3VtW2RhdGEtZW1wdHlde2NvbG9yOnZhcigtLW11dGVkKTtmb250LXN0eWxlOml0YWxpY30KLmFjdGlvbnN7bWFyZ2luLXRvcDoxNHB4fQouYWN0aW9ucyBoM3tmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzouMWVtO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtjb2xvcjp2YXIoLS1nb2xkKTtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo2cHh9CiNhY3Rpb25MaXN0e2ZvbnQtc2l6ZToxMy41cHh9Ci5mb3Jtcy1maWx0ZXJ7ZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLXRvcDoxMnB4fQouY2hpcHtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmcpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czoyMHB4O3BhZGRpbmc6NXB4IDExcHg7Y3Vyc29yOnBvaW50ZXI7dXNlci1zZWxlY3Q6bm9uZX0KLmNoaXAgaW5wdXR7bWFyZ2luOjB9Ci5jaGlwLm9ue2JhY2tncm91bmQ6I2Y2ZWZkZTtib3JkZXItY29sb3I6dmFyKC0tZ29sZCl9Ci5qcm93e2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMzBweCwxZnIpKTtnYXA6MTJweDttYXJnaW4tdG9wOjhweH0KLmpjYXJke2JhY2tncm91bmQ6dmFyKC0tYmcpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzoxMnB4fQouamNhcmQgLmxhYntmb250LXNpemU6MTBweDtsZXR0ZXItc3BhY2luZzouMDdlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7Y29sb3I6dmFyKC0tbXV0ZWQpfQouamNhcmQgLnZhbHtmb250LWZhbWlseTp2YXIoLS1zZXJpZik7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NjAwO21hcmdpbi10b3A6M3B4fQoucGlwZXN7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyIDFmcjtnYXA6MTZweDttYXJnaW4tdG9wOjE0cHh9CkBtZWRpYShtYXgtd2lkdGg6ODYwcHgpey5waXBlc3tncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyfX0KLnBpcGUgaDR7Zm9udC1zaXplOjEzcHg7Zm9udC1mYW1pbHk6dmFyKC0tc2VyaWYpO21hcmdpbi1ib3R0b206OHB4fQouc3RhZ2V7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O21hcmdpbjozcHggMDtmb250LXNpemU6MTEuNXB4fQouc3RhZ2UgLmJhcntoZWlnaHQ6MTRweDtiYWNrZ3JvdW5kOnZhcigtLWMxKTtib3JkZXItcmFkaXVzOjNweDttaW4td2lkdGg6MnB4fQouc3RhZ2UgLm5te2ZsZXg6MCAwIDEzMHB4O2NvbG9yOnZhcigtLWluayl9Ci5zdGFnZSAuY3R7Y29sb3I6dmFyKC0tbXV0ZWQpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc30KLmFza3ttYXJnaW4tdG9wOjE4cHg7ZGlzcGxheTpmbGV4O2dhcDo4cHh9Ci5hc2sgaW5wdXR7ZmxleDoxO2ZvbnQtZmFtaWx5OmluaGVyaXQ7Zm9udC1zaXplOjEzcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLXBhcGVyKX0KLmFzayBidXR0b24sLmJ0bntmb250LWZhbWlseTppbmhlcml0O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouMDVlbTtjb2xvcjojMWExMjA4O2JhY2tncm91bmQ6dmFyKC0tZ29sZCk7Ym9yZGVyOjA7Ym9yZGVyLXJhZGl1czo4cHg7cGFkZGluZzo5cHggMTRweDtjdXJzb3I6cG9pbnRlcn0KLmJ0bi5naG9zdHtiYWNrZ3JvdW5kOnZhcigtLWJnKTtjb2xvcjp2YXIoLS1pbmspO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSl9CiNhc2tBbnN7bWFyZ2luLXRvcDoxMHB4O2ZvbnQtc2l6ZToxM3B4O3doaXRlLXNwYWNlOnByZS13cmFwO2NvbG9yOnZhcigtLWluayl9Ci5mb290e3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZTo5cHg7bGV0dGVyLXNwYWNpbmc6LjIyZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLW11dGVkKTttYXJnaW4tdG9wOjMwcHh9Ci5tdXRlZHtjb2xvcjp2YXIoLS1tdXRlZCl9LmhpZGV7ZGlzcGxheTpub25lfQo8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5Pgo8ZGl2IGNsYXNzPSJ3cmFwIj4KICA8aGVhZGVyPgogICAgPGRpdiBjbGFzcz0iYnJhbmQiPgogICAgICA8ZGl2IGNsYXNzPSJ3Ij5TSUNPUkE8L2Rpdj48ZGl2IGNsYXNzPSJydWxlIj48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0ic3ViIj5DT05TVUxUSU5HICZtaWRkb3Q7IFBFUkZPUk1BTkNFIERBU0hCT0FSRDwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJobWV0YSI+CiAgICAgIDxkaXYgY2xhc3M9ImxpdmUiPjxzcGFuIGNsYXNzPSJkb3QiPjwvc3Bhbj48c3BhbiBpZD0ibGl2ZUxhYmVsIj5MaXZlIGRhdGE8L3NwYW4+PC9kaXY+CiAgICAgIDxkaXYgaWQ9ImdlbkF0Ij48L2Rpdj4KICAgICAgPGRpdj5Bc3RvcmlhIEFkdmVydGlzaW5nIENvbXBhbnk8L2Rpdj4KICAgIDwvZGl2PgogIDwvaGVhZGVyPgoKICA8ZGl2IGNsYXNzPSJjb250cm9scyI+CiAgICA8bGFiZWwgZm9yPSJmX3RmIj5UaW1lZnJhbWU8L2xhYmVsPgogICAgPHNlbGVjdCBpZD0iZl90ZiI+CiAgICAgIDxvcHRpb24gdmFsdWU9Imxhc3QiPkxhc3QgTW9udGg8L29wdGlvbj4KICAgICAgPG9wdGlvbiB2YWx1ZT0iM20iIHNlbGVjdGVkPkxhc3QgMyBNb250aHM8L29wdGlvbj4KICAgICAgPG9wdGlvbiB2YWx1ZT0iNm0iPkxhc3QgNiBNb250aHM8L29wdGlvbj4KICAgICAgPG9wdGlvbiB2YWx1ZT0iYWxsIj5BbGwgVGltZTwvb3B0aW9uPgogICAgPC9zZWxlY3Q+CiAgICA8bGFiZWwgZm9yPSJmX2NtcCI+Q29tcGFyZTwvbGFiZWw+CiAgICA8c2VsZWN0IGlkPSJmX2NtcCI+CiAgICAgIDxvcHRpb24gdmFsdWU9InBlcmlvZCIgc2VsZWN0ZWQ+UHJldmlvdXMgUGVyaW9kPC9vcHRpb24+CiAgICAgIDxvcHRpb24gdmFsdWU9InllYXIiPlByZXZpb3VzIFllYXI8L29wdGlvbj4KICAgIDwvc2VsZWN0PgogICAgPGJ1dHRvbiBjbGFzcz0iYnRuIGdob3N0IiBpZD0iYW5CdG4iIHN0eWxlPSJtYXJnaW4tbGVmdDphdXRvIj5SZWdlbmVyYXRlIGFuYWx5c2lzPC9idXR0b24+CiAgPC9kaXY+CgogIDxkaXYgY2xhc3M9ImtwaXMiIGlkPSJrcGlzIj48L2Rpdj4KCiAgPHNlY3Rpb24gY2xhc3M9ImV4ZWMiPgogICAgPGRpdiBjbGFzcz0ic2VjLWgiPjxoMj5FeGVjdXRpdmUgU3VtbWFyeTwvaDI+PHNwYW4gY2xhc3M9InNlYy1zdWIiIGlkPSJ3aW5MYWJlbCI+PC9zcGFuPjwvZGl2PgogICAgPGRpdiBpZD0iZXhlY1N1bSIgZGF0YS1lbXB0eT0iMSI+QW5hbHlzaXMgcnVucyBvbiB0aGUgbGl2ZSBkYXNoYm9hcmQuPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJhY3Rpb25zIj48aDM+UHJpb3JpdHkgQWN0aW9uczwvaDM+PGRpdiBpZD0iYWN0aW9uTGlzdCIgZGF0YS1lbXB0eT0iMSIgY2xhc3M9Im11dGVkIj5ObyBhY3Rpb24gaXRlbXMgZm9yIHRoaXMgdmlldy48L2Rpdj48L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gR0E0IC0tPgogIDxzZWN0aW9uPgogICAgPGRpdiBjbGFzcz0ic2VjLWgiPjxoMj5XZWJzaXRlIFRyYWZmaWMgJm1pZGRvdDsgR0E0PC9oMj48c3BhbiBjbGFzcz0ic2VjLXN1YiI+U2Vzc2lvbnMsIHVzZXJzIGFuZCBjaGFubmVsIG1peDwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImdyaWQyIj4KICAgICAgPGRpdiBjbGFzcz0iY2hhcnRib3giPjxjYW52YXMgaWQ9ImdhNFRyZW5kIj48L2NhbnZhcz48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2hhcnRib3giPjxjYW52YXMgaWQ9ImdhNENoYW5uZWxzIj48L2NhbnZhcz48L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBpZD0iYW5fZ2E0IiBjbGFzcz0iYW5vdGUiPjxkaXYgY2xhc3M9ImFub3RlLWgiPkdBNCBBbmFseXN0IE5vdGU8L2Rpdj48ZGl2IGNsYXNzPSJhbm90ZS1iIiBkYXRhLWVtcHR5PSIxIj7igJQ8L2Rpdj48L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gR29vZ2xlIEFkcyAtLT4KICA8c2VjdGlvbj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+R29vZ2xlIEFkczwvaDI+PHNwYW4gY2xhc3M9InNlYy1zdWIiPlNwZW5kLCBjb252ZXJzaW9ucyBhbmQgY2FtcGFpZ25zPC9zcGFuPjwvZGl2PgogICAgPGRpdiBjbGFzcz0iZ3JpZDIiPgogICAgICA8ZGl2IGNsYXNzPSJjaGFydGJveCI+PGNhbnZhcyBpZD0iZ2Fkc1RyZW5kIj48L2NhbnZhcz48L2Rpdj4KICAgICAgPGRpdj48dGFibGUgaWQ9ImdhZHNDYW1wcyI+PC90YWJsZT48L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBpZD0iYW5fZ2FkcyIgY2xhc3M9ImFub3RlIj48ZGl2IGNsYXNzPSJhbm90ZS1oIj5Hb29nbGUgQWRzIEFuYWx5c3QgTm90ZTwvZGl2PjxkaXYgY2xhc3M9ImFub3RlLWIiIGRhdGEtZW1wdHk9IjEiPuKAlDwvZGl2PjwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBTZWFyY2ggQ29uc29sZSAtLT4KICA8c2VjdGlvbj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+U2VhcmNoIENvbnNvbGUgJm1pZGRvdDsgU0VPPC9oMj48c3BhbiBjbGFzcz0ic2VjLXN1YiI+Q2xpY2tzLCBpbXByZXNzaW9ucywgcG9zaXRpb24gJmFtcDsgdG9wIHF1ZXJpZXM8L3NwYW4+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJncmlkMiI+CiAgICAgIDxkaXYgY2xhc3M9ImNoYXJ0Ym94Ij48Y2FudmFzIGlkPSJnc2NUcmVuZCI+PC9jYW52YXM+PC9kaXY+CiAgICAgIDxkaXY+PHRhYmxlIGlkPSJnc2NRdWVyaWVzIj48L3RhYmxlPjwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGlkPSJhbl9nc2MiIGNsYXNzPSJhbm90ZSI+PGRpdiBjbGFzcz0iYW5vdGUtaCI+U2VhcmNoIENvbnNvbGUgQW5hbHlzdCBOb3RlPC9kaXY+PGRpdiBjbGFzcz0iYW5vdGUtYiIgZGF0YS1lbXB0eT0iMSI+4oCUPC9kaXY+PC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8IS0tIEdITDogRm9ybXMgJiBTb3VyY2VzIC0tPgogIDxzZWN0aW9uPgogICAgPGRpdiBjbGFzcz0ic2VjLWgiPjxoMj5Gb3JtIFN1Ym1pc3Npb25zICZtaWRkb3Q7IEdvSGlnaExldmVsPC9oMj48c3BhbiBjbGFzcz0ic2VjLXN1YiI+RmlsdGVyIGJ5IGZvcm0g4oCUIHNlbGVjdCBvbmUgb3IgbWFueTwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImZvcm1zLWZpbHRlciIgaWQ9ImZvcm1GaWx0ZXIiPjwvZGl2PgogICAgPGRpdiBjbGFzcz0iZ3JpZDIgZXZlbiI+CiAgICAgIDxkaXYgY2xhc3M9ImNoYXJ0Ym94Ij48Y2FudmFzIGlkPSJnaGxGb3JtcyI+PC9jYW52YXM+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImNoYXJ0Ym94Ij48Y2FudmFzIGlkPSJnaGxTb3VyY2VzIj48L2NhbnZhcz48L2Rpdj4KICAgIDwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBHSEw6IEpvdXJuZXkgLS0+CiAgPHNlY3Rpb24+CiAgICA8ZGl2IGNsYXNzPSJzZWMtaCI+PGgyPkZvcm0tRmlsbGVyIEpvdXJuZXk8L2gyPjxzcGFuIGNsYXNzPSJzZWMtc3ViIiBpZD0ianJuU2NvcGUiPkFsbCBmb3Jtczwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Impyb3ciIGlkPSJqb3VybmV5Q2FyZHMiPjwvZGl2PgogICAgPGRpdiBpZD0iZW1haWxCbG9jayIgY2xhc3M9ImFub3RlIGhpZGUiPjxkaXYgY2xhc3M9ImFub3RlLWgiPkVtYWlsIEVuZ2FnZW1lbnQ8L2Rpdj48ZGl2IGNsYXNzPSJhbm90ZS1iIiBpZD0iZW1haWxCb2R5Ij48L2Rpdj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im11dGVkIiBpZD0iam91cm5leU5vdGUiIHN0eWxlPSJmb250LXNpemU6MTFweDttYXJnaW4tdG9wOjEwcHgiPjwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBHSEw6IFBpcGVsaW5lcyAtLT4KICA8c2VjdGlvbj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+UGlwZWxpbmUgVmlzaWJpbGl0eTwvaDI+PHNwYW4gY2xhc3M9InNlYy1zdWIiPk9wZW4gb3Bwb3J0dW5pdGllcyBieSBwaXBlbGluZSAmYW1wOyBzdGFnZTwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9InBpcGVzIiBpZD0icGlwZXMiPjwvZGl2PgogICAgPGRpdiBpZD0iYW5fZ2hsIiBjbGFzcz0iYW5vdGUiPjxkaXYgY2xhc3M9ImFub3RlLWgiPkdvSGlnaExldmVsIEFuYWx5c3QgTm90ZTwvZGl2PjxkaXYgY2xhc3M9ImFub3RlLWIiIGRhdGEtZW1wdHk9IjEiPuKAlDwvZGl2PjwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBRJkEgLS0+CiAgPHNlY3Rpb24+CiAgICA8ZGl2IGNsYXNzPSJzZWMtaCI+PGgyPkFzayB0aGUgZGF0YTwvaDI+PHNwYW4gY2xhc3M9InNlYy1zdWIiPlF1ZXN0aW9ucyBhbnN3ZXJlZCBmcm9tIHRoaXMgcmVwb3J0IG9ubHk8L3NwYW4+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJhc2siPjxpbnB1dCBpZD0iYXNrUSIgcGxhY2Vob2xkZXI9ImUuZy4gV2hpY2ggZm9ybSBkcml2ZXMgdGhlIG1vc3Qgd29uIHJldmVudWU/Ij48YnV0dG9uIGlkPSJhc2tHbyI+QXNrPC9idXR0b24+PC9kaXY+CiAgICA8ZGl2IGlkPSJhc2tBbnMiPjwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPGRpdiBjbGFzcz0iZm9vdCI+U2ljb3JhIENvbnN1bHRpbmcgJm1pZGRvdDsgQnVpbHQgYnkgQXN0b3JpYSBBZHZlcnRpc2luZyBDb21wYW55ICZtaWRkb3Q7IDxzcGFuIGlkPSJidWlsZE5vIj48L3NwYW4+PC9kaXY+CjwvZGl2PgoKPHNjcmlwdD4KInVzZSBzdHJpY3QiOwovKl9fREFUQV9fKi8KdmFyIERBVEEgPSB3aW5kb3cuX19EQVNIX0RBVEFfXyB8fCB7fTsKdmFyIEhBU0NIQVJUID0gKHR5cGVvZiBDaGFydCAhPT0gJ3VuZGVmaW5lZCcpOwp2YXIgY2hhcnRzID0ge307CnZhciBNRVQgPSAwOyAvLyBtZXRyaWMgaW5kZXggZm9yIEdBNCAoMD1zZXNzaW9ucykKdmFyIHNlbGVjdGVkRm9ybXMgPSBudWxsOyAvLyBudWxsID0gYWxsCgovLyAtLS0tLS0tLS0tIGhlbHBlcnMgLS0tLS0tLS0tLQpmdW5jdGlvbiAkKGlkKXtyZXR1cm4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpO30KZnVuY3Rpb24gZm10KG4pe249K258fDA7cmV0dXJuIG4+PTEwMDA/bi50b0xvY2FsZVN0cmluZygnZW4tVVMnLHttYXhpbXVtRnJhY3Rpb25EaWdpdHM6MH0pOihNYXRoLnJvdW5kKG4qMTApLzEwKycnKS5yZXBsYWNlKC9cLjAkLywnJyk7fQpmdW5jdGlvbiBtb25leShuKXtyZXR1cm4gJyQnKyAoTWF0aC5yb3VuZCgrbnx8MCkpLnRvTG9jYWxlU3RyaW5nKCdlbi1VUycpO30KZnVuY3Rpb24gcGN0KGEsYil7aWYoIWIpcmV0dXJuIG51bGw7cmV0dXJuIChhLWIpL2IqMTAwO30KZnVuY3Rpb24gY2hnSHRtbChjdXIscHJldil7dmFyIHA9cGN0KGN1cixwcmV2KTtpZihwPT09bnVsbClyZXR1cm4gJzxzcGFuIGNsYXNzPSJjaGcgbXV0ZWQiPuKAlDwvc3Bhbj4nO3ZhciB1cD1wPj0wO3JldHVybiAnPHNwYW4gY2xhc3M9ImNoZyAnKyh1cD8ndXAnOidkb3duJykrJyI+JysodXA/J+KWsic6J+KWvCcpKycgJytNYXRoLmFicyhwKS50b0ZpeGVkKDEpKyclIHZzIHByZXY8L3NwYW4+Jzt9CmZ1bmN0aW9uIG1MYWJlbCh5bSl7aWYoIXltKXJldHVybiAnJzt2YXIgeT15bS5zbGljZSgwLDQpLG09K3ltLnNsaWNlKDQsNik7cmV0dXJuIFsnSmFuJywnRmViJywnTWFyJywnQXByJywnTWF5JywnSnVuJywnSnVsJywnQXVnJywnU2VwJywnT2N0JywnTm92JywnRGVjJ11bbS0xXSsiICciK3kuc2xpY2UoMik7fQpmdW5jdGlvbiBhbGxNb250aHMoKXtyZXR1cm4gKERBVEEubW9udGhzfHxbXSkuc2xpY2UoKS5zb3J0KCk7fQpmdW5jdGlvbiB3aW5kb3dNb250aHMoKXt2YXIgbXM9YWxsTW9udGhzKCk7dmFyIHRmPSQoJ2ZfdGYnKS52YWx1ZTtpZih0Zj09PSdhbGwnKXJldHVybiBtczt2YXIgbj10Zj09PSdsYXN0Jz8xOnRmPT09JzNtJz8zOjY7cmV0dXJuIG1zLnNsaWNlKC1uKTt9CmZ1bmN0aW9uIHByZXZNb250aHMod2luKXt2YXIgbXM9YWxsTW9udGhzKCk7dmFyIGNtcD0kKCdmX2NtcCcpLnZhbHVlO2lmKGNtcD09PSd5ZWFyJyl7cmV0dXJuIHdpbi5tYXAoZnVuY3Rpb24obSl7dmFyIHk9K20uc2xpY2UoMCw0KS0xO3JldHVybiAnJyt5K20uc2xpY2UoNCk7fSkuZmlsdGVyKGZ1bmN0aW9uKG0pe3JldHVybiBtcy5pbmRleE9mKG0pPj0wO30pO312YXIgaT1tcy5pbmRleE9mKHdpblswXSk7cmV0dXJuIGk8PTA/W106bXMuc2xpY2UoTWF0aC5tYXgoMCxpLXdpbi5sZW5ndGgpLGkpO30KCnZhciBQQUxFVFRFPVsnI2Y1ODQ1OScsJyM0MDViYTQnLCcjNmU4Mjk4JywnIzhhOWI3ZScsJyNiNTgzNWYnLCcjOWE3ZThkJywnIzg4OTM5YicsJyNkM2MwOGYnLCcjNmY2MjgwJ107CmZ1bmN0aW9uIG1rQ2hhcnQoaWQsY2ZnKXtpZighSEFTQ0hBUlQpcmV0dXJuO2lmKGNoYXJ0c1tpZF0pe2NoYXJ0c1tpZF0uZGVzdHJveSgpO312YXIgZWw9JChpZCk7aWYoIWVsKXJldHVybjtjaGFydHNbaWRdPW5ldyBDaGFydChlbC5nZXRDb250ZXh0KCcyZCcpLGNmZyk7fQpmdW5jdGlvbiBsaW5lQ2ZnKGxhYmVscyxkYXRhc2V0cyl7cmV0dXJuIHt0eXBlOidsaW5lJyxkYXRhOntsYWJlbHM6bGFiZWxzLGRhdGFzZXRzOmRhdGFzZXRzfSxvcHRpb25zOmJhc2VPcHRzKHRydWUpfTt9CmZ1bmN0aW9uIGJhc2VPcHRzKGxlZ2VuZCl7cmV0dXJuIHtyZXNwb25zaXZlOnRydWUsbWFpbnRhaW5Bc3BlY3RSYXRpbzpmYWxzZSxwbHVnaW5zOntsZWdlbmQ6e2Rpc3BsYXk6ISFsZWdlbmQscG9zaXRpb246J2JvdHRvbScsbGFiZWxzOntib3hXaWR0aDoxMCxmb250OntzaXplOjEwfX19fSxzY2FsZXM6e3g6e2dyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19LHk6e2JlZ2luQXRaZXJvOnRydWUsdGlja3M6e2ZvbnQ6e3NpemU6MTB9fX19fTt9CgovLyAtLS0tLS0tLS0tIEdBNCAtLS0tLS0tLS0tCmZ1bmN0aW9uIGdhNE1vbnRoVG90YWwoeW0pe3ZhciB0PShEQVRBLnRvdGFscyYmREFUQS50b3RhbHNbeW1dKXx8bnVsbDtpZih0KXJldHVybiB0O3ZhciBjaG09KERBVEEuY2htJiZEQVRBLmNobVt5bV0pfHx7fTt2YXIgcz1bMCwwLDAsMCwwXTtPYmplY3Qua2V5cyhjaG0pLmZvckVhY2goZnVuY3Rpb24oYyl7Y2htW2NdLmZvckVhY2goZnVuY3Rpb24odixpKXtzW2ldKz0rdnx8MDt9KTt9KTtyZXR1cm4gczt9CmZ1bmN0aW9uIHN1bU1ldHJpYyh3aW4saWR4KXtyZXR1cm4gd2luLnJlZHVjZShmdW5jdGlvbihhLG0pe3JldHVybiBhKyhnYTRNb250aFRvdGFsKG0pW2lkeF18fDApO30sMCk7fQpmdW5jdGlvbiByZW5kZXJHQTQoKXsKICB2YXIgd2luPXdpbmRvd01vbnRocygpOwogIC8vIHRyZW5kOiBzZXNzaW9ucyArIHVzZXJzCiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIHNlc3M9d2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4gZ2E0TW9udGhUb3RhbChtKVswXTt9KTsKICB2YXIgdXNlcnM9d2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4gZ2E0TW9udGhUb3RhbChtKVsxXTt9KTsKICBta0NoYXJ0KCdnYTRUcmVuZCcse3R5cGU6J2xpbmUnLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6WwogICAge2xhYmVsOidTZXNzaW9ucycsZGF0YTpzZXNzLGJvcmRlckNvbG9yOlBBTEVUVEVbMF0sYmFja2dyb3VuZENvbG9yOidyZ2JhKDI0NSwxMzIsODksLjEyKScsZmlsbDp0cnVlLHRlbnNpb246LjN9LAogICAge2xhYmVsOidVc2VycycsZGF0YTp1c2Vycyxib3JkZXJDb2xvcjpQQUxFVFRFWzJdLGJhY2tncm91bmRDb2xvcjondHJhbnNwYXJlbnQnLHRlbnNpb246LjN9CiAgXX0sb3B0aW9uczpiYXNlT3B0cyh0cnVlKX0pOwogIC8vIGNoYW5uZWwgbWl4IGZvciBsYXN0IG1vbnRoIGluIHdpbmRvdwogIHZhciBsYXN0PXdpblt3aW4ubGVuZ3RoLTFdO3ZhciBjaG09KERBVEEuY2htJiZEQVRBLmNobVtsYXN0XSl8fHt9OwogIHZhciBlbnRyaWVzPU9iamVjdC5rZXlzKGNobSkubWFwKGZ1bmN0aW9uKGMpe3JldHVybiBbYyxjaG1bY11bMF18fDBdO30pLnNvcnQoZnVuY3Rpb24oYSxiKXtyZXR1cm4gYlsxXS1hWzFdO30pOwogIG1rQ2hhcnQoJ2dhNENoYW5uZWxzJyx7dHlwZTonZG91Z2hudXQnLGRhdGE6e2xhYmVsczplbnRyaWVzLm1hcChmdW5jdGlvbihlKXtyZXR1cm4gZVswXTt9KSxkYXRhc2V0czpbe2RhdGE6ZW50cmllcy5tYXAoZnVuY3Rpb24oZSl7cmV0dXJuIGVbMV07fSksYmFja2dyb3VuZENvbG9yOlBBTEVUVEV9XX0sb3B0aW9uczp7cmVzcG9uc2l2ZTp0cnVlLG1haW50YWluQXNwZWN0UmF0aW86ZmFsc2UscGx1Z2luczp7bGVnZW5kOntwb3NpdGlvbjoncmlnaHQnLGxhYmVsczp7Ym94V2lkdGg6MTAsZm9udDp7c2l6ZToxMH19fSx0aXRsZTp7ZGlzcGxheTp0cnVlLHRleHQ6J0NoYW5uZWwgbWl4IOKAlCAnK21MYWJlbChsYXN0KSxmb250OntzaXplOjExfX19fX0pOwp9CgovLyAtLS0tLS0tLS0tIEdvb2dsZSBBZHMgLS0tLS0tLS0tLQpmdW5jdGlvbiBnYWRzTW9udGhBZ2coeW0pe3ZhciBkPShEQVRBLmdhZHMmJkRBVEEuZ2Fkcy5kYXRhJiZEQVRBLmdhZHMuZGF0YVt5bV0pfHx7fTt2YXIgcz1bMCwwLDAsMF07T2JqZWN0LmtleXMoZCkuZm9yRWFjaChmdW5jdGlvbihjKXtkW2NdLmZvckVhY2goZnVuY3Rpb24odixpKXtzW2ldKz0rdnx8MDt9KTt9KTtyZXR1cm4gczt9IC8vIFtjbGlja3MsaW1wcixjb3N0LGNvbnZdCmZ1bmN0aW9uIHJlbmRlckdhZHMoKXsKICB2YXIgd2luPXdpbmRvd01vbnRocygpLmZpbHRlcihmdW5jdGlvbihtKXtyZXR1cm4gREFUQS5nYWRzJiZEQVRBLmdhZHMuZGF0YSYmREFUQS5nYWRzLmRhdGFbbV07fSk7CiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGNvc3Q9d2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4gZ2Fkc01vbnRoQWdnKG0pWzJdO30pOwogIHZhciBjb252PXdpbi5tYXAoZnVuY3Rpb24obSl7cmV0dXJuIGdhZHNNb250aEFnZyhtKVszXTt9KTsKICBta0NoYXJ0KCdnYWRzVHJlbmQnLHt0eXBlOidiYXInLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6WwogICAge3R5cGU6J2JhcicsbGFiZWw6J1NwZW5kICgkKScsZGF0YTpjb3N0LGJhY2tncm91bmRDb2xvcjpQQUxFVFRFWzBdLHlBeGlzSUQ6J3knLG9yZGVyOjJ9LAogICAge3R5cGU6J2xpbmUnLGxhYmVsOidDb252ZXJzaW9ucycsZGF0YTpjb252LGJvcmRlckNvbG9yOlBBTEVUVEVbMV0seUF4aXNJRDoneTEnLHRlbnNpb246LjMsb3JkZXI6MX0KICBdfSxvcHRpb25zOntyZXNwb25zaXZlOnRydWUsbWFpbnRhaW5Bc3BlY3RSYXRpbzpmYWxzZSxwbHVnaW5zOntsZWdlbmQ6e3Bvc2l0aW9uOidib3R0b20nLGxhYmVsczp7Ym94V2lkdGg6MTAsZm9udDp7c2l6ZToxMH19fX0sc2NhbGVzOnt4OntncmlkOntkaXNwbGF5OmZhbHNlfSx0aWNrczp7Zm9udDp7c2l6ZToxMH19fSx5OntiZWdpbkF0WmVybzp0cnVlLHBvc2l0aW9uOidsZWZ0Jyx0aWNrczp7Zm9udDp7c2l6ZToxMH19fSx5MTp7YmVnaW5BdFplcm86dHJ1ZSxwb3NpdGlvbjoncmlnaHQnLGdyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19fX19KTsKICAvLyBjYW1wYWlnbnMgdGFibGUgZm9yIGxhc3QgbW9udGgKICB2YXIgbGFzdD13aW5bd2luLmxlbmd0aC0xXTt2YXIgZD0oREFUQS5nYWRzJiZEQVRBLmdhZHMuZGF0YSYmREFUQS5nYWRzLmRhdGFbbGFzdF0pfHx7fTsKICB2YXIgcm93cz1PYmplY3Qua2V5cyhkKS5tYXAoZnVuY3Rpb24oYyl7dmFyIHY9ZFtjXTtyZXR1cm4ge2M6YyxjbGlja3M6dlswXSxjb3N0OnZbMl0sY29udjp2WzNdfTt9KS5zb3J0KGZ1bmN0aW9uKGEsYil7cmV0dXJuIGIuY29zdC1hLmNvc3Q7fSk7CiAgdmFyIGh0bWw9Jzx0cj48dGg+Q2FtcGFpZ24g4oCUICcrbUxhYmVsKGxhc3QpKyc8L3RoPjx0aCBjbGFzcz0ibnVtIj5DbGlja3M8L3RoPjx0aCBjbGFzcz0ibnVtIj5TcGVuZDwvdGg+PHRoIGNsYXNzPSJudW0iPkNvbnY8L3RoPjx0aCBjbGFzcz0ibnVtIj5DUEE8L3RoPjwvdHI+JzsKICByb3dzLmZvckVhY2goZnVuY3Rpb24ocil7aHRtbCs9Jzx0cj48dGQ+Jytlc2Moci5jKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+JytmbXQoci5jbGlja3MpKyc8L3RkPjx0ZCBjbGFzcz0ibnVtIj4nK21vbmV5KHIuY29zdCkrJzwvdGQ+PHRkIGNsYXNzPSJudW0iPicrZm10KHIuY29udikrJzwvdGQ+PHRkIGNsYXNzPSJudW0iPicrKHIuY29udj9tb25leShyLmNvc3Qvci5jb252KTon4oCUJykrJzwvdGQ+PC90cj4nO30pOwogICQoJ2dhZHNDYW1wcycpLmlubmVySFRNTD1odG1sfHwnPHRyPjx0ZCBjbGFzcz0ibXV0ZWQiPk5vIGNhbXBhaWduIGRhdGEuPC90ZD48L3RyPic7Cn0KCi8vIC0tLS0tLS0tLS0gU2VhcmNoIENvbnNvbGUgLS0tLS0tLS0tLQpmdW5jdGlvbiByZW5kZXJHU0MoKXsKICB2YXIgd2luPXdpbmRvd01vbnRocygpLmZpbHRlcihmdW5jdGlvbihtKXtyZXR1cm4gREFUQS5nc2MmJkRBVEEuZ3NjLmRhdGEmJkRBVEEuZ3NjLmRhdGFbbV07fSk7CiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGNsaWNrcz13aW4ubWFwKGZ1bmN0aW9uKG0pe3JldHVybiBEQVRBLmdzYy5kYXRhW21dWzBdO30pOwogIHZhciBwb3M9d2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4gREFUQS5nc2MuZGF0YVttXVsyXTt9KTsKICBta0NoYXJ0KCdnc2NUcmVuZCcse3R5cGU6J2JhcicsZGF0YTp7bGFiZWxzOmxhYmVscyxkYXRhc2V0czpbCiAgICB7dHlwZTonYmFyJyxsYWJlbDonQ2xpY2tzJyxkYXRhOmNsaWNrcyxiYWNrZ3JvdW5kQ29sb3I6UEFMRVRURVsyXSx5QXhpc0lEOid5JyxvcmRlcjoyfSwKICAgIHt0eXBlOidsaW5lJyxsYWJlbDonQXZnIHBvc2l0aW9uJyxkYXRhOnBvcyxib3JkZXJDb2xvcjpQQUxFVFRFWzRdLHlBeGlzSUQ6J3kxJyx0ZW5zaW9uOi4zLG9yZGVyOjF9CiAgXX0sb3B0aW9uczp7cmVzcG9uc2l2ZTp0cnVlLG1haW50YWluQXNwZWN0UmF0aW86ZmFsc2UscGx1Z2luczp7bGVnZW5kOntwb3NpdGlvbjonYm90dG9tJyxsYWJlbHM6e2JveFdpZHRoOjEwLGZvbnQ6e3NpemU6MTB9fX19LHNjYWxlczp7eDp7Z3JpZDp7ZGlzcGxheTpmYWxzZX0sdGlja3M6e2ZvbnQ6e3NpemU6MTB9fX0seTp7YmVnaW5BdFplcm86dHJ1ZSxwb3NpdGlvbjonbGVmdCcsdGlja3M6e2ZvbnQ6e3NpemU6MTB9fX0seTE6e3JldmVyc2U6dHJ1ZSxwb3NpdGlvbjoncmlnaHQnLGdyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19fX19KTsKICB2YXIgbGFzdD13aW5bd2luLmxlbmd0aC0xXTt2YXIgcT0oREFUQS5nc2MmJkRBVEEuZ3NjLnF1ZXJpZXMmJkRBVEEuZ3NjLnF1ZXJpZXNbbGFzdF0pfHx7fTsKICB2YXIgcm93cz1PYmplY3Qua2V5cyhxKS5tYXAoZnVuY3Rpb24oayl7cmV0dXJuIHtrOmssYzpxW2tdWzBdLGk6cVtrXVsxXSxwOnFba11bMl19O30pLnNvcnQoZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi5jLWEuYzt9KS5zbGljZSgwLDgpOwogIHZhciBodG1sPSc8dHI+PHRoPlRvcCBxdWVyeSDigJQgJyttTGFiZWwobGFzdCkrJzwvdGg+PHRoIGNsYXNzPSJudW0iPkNsaWNrczwvdGg+PHRoIGNsYXNzPSJudW0iPkltcHI8L3RoPjx0aCBjbGFzcz0ibnVtIj5Qb3M8L3RoPjwvdHI+JzsKICByb3dzLmZvckVhY2goZnVuY3Rpb24ocil7aHRtbCs9Jzx0cj48dGQ+Jytlc2Moci5rKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+JytmbXQoci5jKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+JytmbXQoci5pKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+Jysoci5wP3IucC50b0ZpeGVkKDEpOifigJQnKSsnPC90ZD48L3RyPic7fSk7CiAgJCgnZ3NjUXVlcmllcycpLmlubmVySFRNTD1odG1sfHwnPHRyPjx0ZCBjbGFzcz0ibXV0ZWQiPk5vIHF1ZXJ5IGRhdGEuPC90ZD48L3RyPic7Cn0KCi8vIC0tLS0tLS0tLS0gR0hMIC0tLS0tLS0tLS0KZnVuY3Rpb24gZ2hsRm9ybXMoKXtyZXR1cm4gKERBVEEuZ2hsJiZEQVRBLmdobC5mb3Jtcyl8fFtdO30KZnVuY3Rpb24gYWN0aXZlRm9ybXMoKXtyZXR1cm4gc2VsZWN0ZWRGb3Jtc3x8Z2hsRm9ybXMoKS5tYXAoZnVuY3Rpb24oZil7cmV0dXJuIGYubmFtZTt9KTt9CmZ1bmN0aW9uIHJlbmRlckZvcm1GaWx0ZXIoKXsKICB2YXIgYm94PSQoJ2Zvcm1GaWx0ZXInKTt2YXIgZm9ybXM9Z2hsRm9ybXMoKTsKICBpZighZm9ybXMubGVuZ3RoKXtib3guaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0ibXV0ZWQiPk5vIEdvSGlnaExldmVsIGZvcm0gZGF0YS48L3NwYW4+JztyZXR1cm47fQogIHZhciBzZWw9YWN0aXZlRm9ybXMoKTsKICBib3guaW5uZXJIVE1MPWZvcm1zLm1hcChmdW5jdGlvbihmKXt2YXIgb249c2VsLmluZGV4T2YoZi5uYW1lKT49MDtyZXR1cm4gJzxsYWJlbCBjbGFzcz0iY2hpcCAnKyhvbj8nb24nOicnKSsnIj48aW5wdXQgdHlwZT0iY2hlY2tib3giIGRhdGEtZm9ybT0iJytlc2MoZi5uYW1lKSsnIiAnKyhvbj8nY2hlY2tlZCc6JycpKyc+Jytlc2MoZi5uYW1lKSsnIDxzcGFuIGNsYXNzPSJtdXRlZCI+KCcrZi50b3RhbCsnKTwvc3Bhbj48L2xhYmVsPic7fSkuam9pbignJyk7CiAgQXJyYXkucHJvdG90eXBlLmZvckVhY2guY2FsbChib3gucXVlcnlTZWxlY3RvckFsbCgnaW5wdXQnKSxmdW5jdGlvbihjYil7Y2IuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJyxvbkZvcm1Ub2dnbGUpO30pOwp9CmZ1bmN0aW9uIG9uRm9ybVRvZ2dsZSgpewogIHZhciBib3g9JCgnZm9ybUZpbHRlcicpO3ZhciBvbj1bXTsKICBBcnJheS5wcm90b3R5cGUuZm9yRWFjaC5jYWxsKGJveC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpLGZ1bmN0aW9uKGNiKXtpZihjYi5jaGVja2VkKW9uLnB1c2goY2IuZ2V0QXR0cmlidXRlKCdkYXRhLWZvcm0nKSk7fSk7CiAgc2VsZWN0ZWRGb3Jtcz1vbi5sZW5ndGg/b246bnVsbDsgLy8gbm9uZSBjaGVja2VkID0gdHJlYXQgYXMgYWxsCiAgcmVuZGVyRm9ybUZpbHRlcigpO3JlbmRlckdITEZvcm1zKCk7cmVuZGVySm91cm5leSgpOwp9CmZ1bmN0aW9uIHJlbmRlckdITEZvcm1zKCl7CiAgdmFyIGJ5TW9udGg9KERBVEEuZ2hsJiZEQVRBLmdobC5ieU1vbnRoKXx8e307CiAgdmFyIHdpbj13aW5kb3dNb250aHMoKS5maWx0ZXIoZnVuY3Rpb24obSl7cmV0dXJuIGJ5TW9udGhbbV07fSk7CiAgdmFyIGZvcm1zPWFjdGl2ZUZvcm1zKCk7CiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGRzPWZvcm1zLm1hcChmdW5jdGlvbihmLGkpe3JldHVybiB7bGFiZWw6ZixkYXRhOndpbi5tYXAoZnVuY3Rpb24obSl7cmV0dXJuIChieU1vbnRoW21dJiZieU1vbnRoW21dW2ZdKXx8MDt9KSxiYWNrZ3JvdW5kQ29sb3I6UEFMRVRURVtpJVBBTEVUVEUubGVuZ3RoXX07fSk7CiAgbWtDaGFydCgnZ2hsRm9ybXMnLHt0eXBlOidiYXInLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6ZHN9LG9wdGlvbnM6e3Jlc3BvbnNpdmU6dHJ1ZSxtYWludGFpbkFzcGVjdFJhdGlvOmZhbHNlLHBsdWdpbnM6e2xlZ2VuZDp7cG9zaXRpb246J2JvdHRvbScsbGFiZWxzOntib3hXaWR0aDoxMCxmb250OntzaXplOjl9fX0sdGl0bGU6e2Rpc3BsYXk6dHJ1ZSx0ZXh0OidGb3JtIHN1Ym1pc3Npb25zIGJ5IG1vbnRoJyxmb250OntzaXplOjExfX19LHNjYWxlczp7eDp7c3RhY2tlZDp0cnVlLGdyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19LHk6e3N0YWNrZWQ6dHJ1ZSxiZWdpbkF0WmVybzp0cnVlLHRpY2tzOntmb250OntzaXplOjEwfX19fX19KTsKICAvLyBzb3VyY2VzOiBhZ2dyZWdhdGUgbWFya2V0aW5nIGNoYW5uZWxzIGFjcm9zcyBzZWxlY3RlZCBmb3JtcwogIHZhciBzcmNBZ2c9e307CiAgZ2hsRm9ybXMoKS5mb3JFYWNoKGZ1bmN0aW9uKGYpe2lmKGZvcm1zLmluZGV4T2YoZi5uYW1lKTwwKXJldHVybjtPYmplY3Qua2V5cyhmLmNoYW5uZWxzfHx7fSkuZm9yRWFjaChmdW5jdGlvbihjaCl7c3JjQWdnW2NoXT0oc3JjQWdnW2NoXXx8MCkrZi5jaGFubmVsc1tjaF07fSk7fSk7CiAgdmFyIGVudHM9T2JqZWN0LmtleXMoc3JjQWdnKS5tYXAoZnVuY3Rpb24oayl7cmV0dXJuIFtrLHNyY0FnZ1trXV07fSkuc29ydChmdW5jdGlvbihhLGIpe3JldHVybiBiWzFdLWFbMV07fSk7CiAgbWtDaGFydCgnZ2hsU291cmNlcycse3R5cGU6J2RvdWdobnV0JyxkYXRhOntsYWJlbHM6ZW50cy5tYXAoZnVuY3Rpb24oZSl7cmV0dXJuIHByZXR0eVNyYyhlWzBdKTt9KSxkYXRhc2V0czpbe2RhdGE6ZW50cy5tYXAoZnVuY3Rpb24oZSl7cmV0dXJuIGVbMV07fSksYmFja2dyb3VuZENvbG9yOlBBTEVUVEV9XX0sb3B0aW9uczp7cmVzcG9uc2l2ZTp0cnVlLG1haW50YWluQXNwZWN0UmF0aW86ZmFsc2UscGx1Z2luczp7bGVnZW5kOntwb3NpdGlvbjoncmlnaHQnLGxhYmVsczp7Ym94V2lkdGg6MTAsZm9udDp7c2l6ZToxMH19fSx0aXRsZTp7ZGlzcGxheTp0cnVlLHRleHQ6J01hcmtldGluZyBzb3VyY2Ugb2YgZmlsbHMnLGZvbnQ6e3NpemU6MTF9fX19fSk7Cn0KZnVuY3Rpb24gcHJldHR5U3JjKHMpe3JldHVybiBTdHJpbmcoc3x8JycpLnJlcGxhY2UoL18vZywnICcpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXGJcdy9nLGZ1bmN0aW9uKGMpe3JldHVybiBjLnRvVXBwZXJDYXNlKCk7fSk7fQpmdW5jdGlvbiByZW5kZXJKb3VybmV5KCl7CiAgdmFyIGZvcm1zPWFjdGl2ZUZvcm1zKCk7CiAgJCgnanJuU2NvcGUnKS50ZXh0Q29udGVudD0oc2VsZWN0ZWRGb3Jtcz9mb3Jtcy5qb2luKCcsICcpOidBbGwgZm9ybXMnKTsKICB2YXIgY29udGFjdHM9KChEQVRBLmdobCYmREFUQS5naGwuY29udGFjdHMpfHxbXSkuZmlsdGVyKGZ1bmN0aW9uKGMpe3JldHVybiBjLmlzRm9ybSYmZm9ybXMuaW5kZXhPZihjLmZvcm0pPj0wO30pOwogIHZhciBuPWNvbnRhY3RzLmxlbmd0aDsKICB2YXIgdHhuPWNvbnRhY3RzLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gYy50eG47fSkubGVuZ3RoOwogIHZhciB2YWw9Y29udGFjdHMucmVkdWNlKGZ1bmN0aW9uKGEsYyl7cmV0dXJuIGErKCtjLnR4blZhbHx8MCk7fSwwKTsKICB2YXIgcmVjPWNvbnRhY3RzLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gYy5yZWN1cnJpbmc7fSkubGVuZ3RoOwogIHZhciBpblBpcGU9Y29udGFjdHMuZmlsdGVyKGZ1bmN0aW9uKGMpe3JldHVybiBjLnBpcGVsaW5lO30pLmxlbmd0aDsKICB2YXIgd29uPWNvbnRhY3RzLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gL3dvbi9pLnRlc3QoYy5vcHBTdGF0dXN8fCcnKTt9KS5sZW5ndGg7CiAgdmFyIGNhcmRzPVsKICAgIFsnQ29udGFjdHMnLGZtdChuKV0sCiAgICBbJ1RyYW5zYWN0ZWQnLGZtdCh0eG4pKyhuPycgKCcrTWF0aC5yb3VuZCh0eG4vbioxMDApKyclKSc6JycpXSwKICAgIFsnVHJhbnNhY3Rpb24gdmFsdWUnLG1vbmV5KHZhbCldLAogICAgWydNZW1iZXJzaGlwcycsZm10KHJlYyldLAogICAgWydJbiBhIHBpcGVsaW5lJyxmbXQoaW5QaXBlKV0sCiAgICBbJ0Nsb3NlZC13b24nLGZtdCh3b24pXQogIF07CiAgJCgnam91cm5leUNhcmRzJykuaW5uZXJIVE1MPWNhcmRzLm1hcChmdW5jdGlvbihjKXtyZXR1cm4gJzxkaXYgY2xhc3M9ImpjYXJkIj48ZGl2IGNsYXNzPSJsYWIiPicrY1swXSsnPC9kaXY+PGRpdiBjbGFzcz0idmFsIj4nK2NbMV0rJzwvZGl2PjwvZGl2Pic7fSkuam9pbignJyk7CiAgLy8gc3RhZ2UgZGlzdHJpYnV0aW9uIG5vdGUKICB2YXIgYnlTdGFnZT17fTtjb250YWN0cy5mb3JFYWNoKGZ1bmN0aW9uKGMpe2lmKGMuc3RhZ2Upe3ZhciBrPShjLnBpcGVsaW5lP2MucGlwZWxpbmUrJyDCtyAnOicnKStjLnN0YWdlO2J5U3RhZ2Vba109KGJ5U3RhZ2Vba118fDApKzE7fX0pOwogIHZhciB0b3A9T2JqZWN0LmtleXMoYnlTdGFnZSkubWFwKGZ1bmN0aW9uKGspe3JldHVybiBbayxieVN0YWdlW2tdXTt9KS5zb3J0KGZ1bmN0aW9uKGEsYil7cmV0dXJuIGJbMV0tYVsxXTt9KS5zbGljZSgwLDQpOwogIHZhciBub3RlPXRvcC5sZW5ndGg/KCdDdXJyZW50IHN0YWdlczogJyt0b3AubWFwKGZ1bmN0aW9uKHQpe3JldHVybiB0WzBdKycgKCcrdFsxXSsnKSc7fSkuam9pbignLCAnKSsnLicpOicnOwogIGlmKERBVEEuZ2hsJiZEQVRBLmdobC5jb250YWN0c0NhcHBlZClub3RlKz0nIEpvdXJuZXkgc2FtcGxlZCBmcm9tIHRoZSBtb3N0IHJlY2VudCAnK0RBVEEuZ2hsLmNvbnRhY3RzQ2FwcGVkKycgY29udGFjdHMuJzsKICAkKCdqb3VybmV5Tm90ZScpLnRleHRDb250ZW50PW5vdGU7CiAgLy8gZW1haWwgYmxvY2sKICB2YXIgZW09REFUQS5naGwmJkRBVEEuZ2hsLmVtYWlsOwogIGlmKGVtJiZlbS50b3RhbHMpeyQoJ2VtYWlsQmxvY2snKS5jbGFzc0xpc3QucmVtb3ZlKCdoaWRlJyk7dmFyIHQ9ZW0udG90YWxzOyQoJ2VtYWlsQm9keScpLnRleHRDb250ZW50PSdTZW50ICcrZm10KHQuc2VudCkrJywgZGVsaXZlcmVkICcrZm10KHQuZGVsaXZlcmVkKSsnLCBvcGVuZWQgJytmbXQodC5vcGVuZWQpKycgKCcrTWF0aC5yb3VuZCgoZW0ucmF0ZXMub3Blbnx8MCkqMTAwKSsnJSksIGNsaWNrZWQgJytmbXQodC5jbGlja2VkKSsnICgnK01hdGgucm91bmQoKGVtLnJhdGVzLmNsaWNrfHwwKSoxMDApKyclKS4gU291cmNlOiAnK2VtLnNvdXJjZSsnLic7fQogIGVsc2V7JCgnZW1haWxCbG9jaycpLmNsYXNzTGlzdC5hZGQoJ2hpZGUnKTt9Cn0KZnVuY3Rpb24gcmVuZGVyUGlwZXMoKXsKICB2YXIgcGlwZXM9KERBVEEuZ2hsJiZEQVRBLmdobC5waXBlbGluZXMpfHxbXTsKICBpZighcGlwZXMubGVuZ3RoKXskKCdwaXBlcycpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Im11dGVkIj5ObyBwaXBlbGluZSBkYXRhLjwvc3Bhbj4nO3JldHVybjt9CiAgdmFyIGh0bWw9cGlwZXMubWFwKGZ1bmN0aW9uKHApewogICAgdmFyIG1heD1NYXRoLm1heC5hcHBseShudWxsLHAuc3RhZ2VzLm1hcChmdW5jdGlvbihzKXtyZXR1cm4gcy5uO30pLmNvbmNhdChbMV0pKTsKICAgIHZhciByb3dzPXAuc3RhZ2VzLm1hcChmdW5jdGlvbihzKXt2YXIgdz1NYXRoLnJvdW5kKHMubi9tYXgqMTIwKTtyZXR1cm4gJzxkaXYgY2xhc3M9InN0YWdlIj48c3BhbiBjbGFzcz0ibm0iPicrZXNjKHMubmFtZSkrJzwvc3Bhbj48c3BhbiBjbGFzcz0iYmFyIiBzdHlsZT0id2lkdGg6Jyt3KydweCI+PC9zcGFuPjxzcGFuIGNsYXNzPSJjdCI+JytzLm4rKHMudmFsdWU/JyDCtyAnK21vbmV5KHMudmFsdWUpOicnKSsnPC9zcGFuPjwvZGl2Pic7fSkuam9pbignJyk7CiAgICByZXR1cm4gJzxkaXYgY2xhc3M9InBpcGUiPjxoND4nK2VzYyhwLm5hbWUpKyc8L2g0Picrcm93cysnPC9kaXY+JzsKICB9KS5qb2luKCcnKTsKICAkKCdwaXBlcycpLmlubmVySFRNTD1odG1sOwp9CgovLyAtLS0tLS0tLS0tIEtQSXMgLS0tLS0tLS0tLQpmdW5jdGlvbiByZW5kZXJLUElzKCl7CiAgdmFyIHdpbj13aW5kb3dNb250aHMoKSxwcmV2PXByZXZNb250aHMod2luKTsKICB2YXIgc2Vzcz1zdW1NZXRyaWMod2luLDApLHNlc3NQPXN1bU1ldHJpYyhwcmV2LDApOwogIHZhciB1c2Vycz1zdW1NZXRyaWMod2luLDEpLHVzZXJzUD1zdW1NZXRyaWMocHJldiwxKTsKICB2YXIgZ2Fkc0Nvc3Q9d2luLnJlZHVjZShmdW5jdGlvbihhLG0pe3JldHVybiBhK2dhZHNNb250aEFnZyhtKVsyXTt9LDApOwogIHZhciBnYWRzQ29udj13aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7cmV0dXJuIGErZ2Fkc01vbnRoQWdnKG0pWzNdO30sMCk7CiAgdmFyIGdzY0NsaWNrcz13aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7cmV0dXJuIGErKChEQVRBLmdzYyYmREFUQS5nc2MuZGF0YSYmREFUQS5nc2MuZGF0YVttXSYmREFUQS5nc2MuZGF0YVttXVswXSl8fDApO30sMCk7CiAgdmFyIGZpbGxzPXdpbi5yZWR1Y2UoZnVuY3Rpb24oYSxtKXt2YXIgYm09KERBVEEuZ2hsJiZEQVRBLmdobC5ieU1vbnRoJiZEQVRBLmdobC5ieU1vbnRoW21dKXx8e307cmV0dXJuIGErT2JqZWN0LmtleXMoYm0pLnJlZHVjZShmdW5jdGlvbihzLGspe3JldHVybiBzK2JtW2tdO30sMCk7fSwwKTsKICB2YXIgcGlwZVZhbD0oREFUQS5naGwmJkRBVEEuZ2hsLnN1bW1hcnkmJkRBVEEuZ2hsLnN1bW1hcnkub3BlblZhbHVlKXx8MDsKICB2YXIgd29uPShEQVRBLmdobCYmREFUQS5naGwuc3VtbWFyeSYmREFUQS5naGwuc3VtbWFyeS53b25WYWx1ZSl8fDA7CiAgdmFyIGs9WwogICAge2xhYjonU2Vzc2lvbnMnLHZhbDpmbXQoc2VzcyksY2hnOmNoZ0h0bWwoc2VzcyxzZXNzUCl9LAogICAge2xhYjonVXNlcnMnLHZhbDpmbXQodXNlcnMpLGNoZzpjaGdIdG1sKHVzZXJzLHVzZXJzUCl9LAogICAge2xhYjonQWQgU3BlbmQnLHZhbDptb25leShnYWRzQ29zdCksY2hnOic8c3BhbiBjbGFzcz0iY2hnIG11dGVkIj4nK2ZtdChnYWRzQ29udikrJyBjb252PC9zcGFuPid9LAogICAge2xhYjonU0VPIENsaWNrcycsdmFsOmZtdChnc2NDbGlja3MpLGNoZzonPHNwYW4gY2xhc3M9ImNoZyBtdXRlZCI+b3JnYW5pYzwvc3Bhbj4nfSwKICAgIHtsYWI6J0Zvcm0gRmlsbHMnLHZhbDpmbXQoZmlsbHMpLGNoZzonPHNwYW4gY2xhc3M9ImNoZyBtdXRlZCI+R29IaWdoTGV2ZWw8L3NwYW4+J30sCiAgICB7bGFiOidPcGVuIFBpcGVsaW5lJyx2YWw6bW9uZXkocGlwZVZhbCksY2hnOic8c3BhbiBjbGFzcz0iY2hnIHVwIj4nK21vbmV5KHdvbikrJyB3b248L3NwYW4+J30KICBdOwogICQoJ2twaXMnKS5pbm5lckhUTUw9ay5tYXAoZnVuY3Rpb24oeCl7cmV0dXJuICc8ZGl2IGNsYXNzPSJrcGkiPjxkaXYgY2xhc3M9ImxhYiI+Jyt4LmxhYisnPC9kaXY+PGRpdiBjbGFzcz0idmFsIj4nK3gudmFsKyc8L2Rpdj4nK3guY2hnKyc8L2Rpdj4nO30pLmpvaW4oJycpOwp9CgpmdW5jdGlvbiBlc2Mocyl7cmV0dXJuIFN0cmluZyhzPT1udWxsPycnOnMpLnJlcGxhY2UoL1smPD4iXS9nLGZ1bmN0aW9uKGMpe3JldHVybiB7JyYnOicmYW1wOycsJzwnOicmbHQ7JywnPic6JyZndDsnLCciJzonJnF1b3Q7J31bY107fSk7fQoKLy8gLS0tLS0tLS0tLSBhbmFseXN0IG5vdGVzIChwZXIgcmVwb3J0aW5nIHdpbmRvdykgLS0tLS0tLS0tLQp2YXIgTFM9J3NpY29yYV9hbl8nOwp2YXIgQUxMSz1bJ3N1bW1hcnknLCdnYTQnLCdnYWRzJywnZ3NjJywnZ2hsJ107CnZhciBBTl9JRFM9e2dhNDonYW5fZ2E0JyxnYWRzOidhbl9nYWRzJyxnc2M6J2FuX2dzYycsZ2hsOidhbl9naGwnfTsKdmFyIGFuQnVzeT1mYWxzZTsKZnVuY3Rpb24gYm9keUVsKGspe3JldHVybiBrPT09J3N1bW1hcnknPyQoJ2V4ZWNTdW0nKTooZnVuY3Rpb24oKXt2YXIgcz0kKEFOX0lEU1trXSk7cmV0dXJuIHM/cy5xdWVyeVNlbGVjdG9yKCcuYW5vdGUtYicpOm51bGw7fSkoKTt9CmZ1bmN0aW9uIGN1clNpZygpe3JldHVybiB3aW5kb3cuX19BTlNJR3x8Jyc7fQpmdW5jdGlvbiBsc0dldChrKXt0cnl7cmV0dXJuIGxvY2FsU3RvcmFnZS5nZXRJdGVtKExTK2N1clNpZygpKydfJytrKTt9Y2F0Y2goZSl7cmV0dXJuIG51bGw7fX0KZnVuY3Rpb24gbHNTZXQoayx2KXt0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oTFMrY3VyU2lnKCkrJ18nK2ssdik7fWNhdGNoKGUpe319CmZ1bmN0aW9uIHNldFRleHQoayx0KXt2YXIgZWw9Ym9keUVsKGspO2lmKCFlbClyZXR1cm47ZWwudGV4dENvbnRlbnQ9dDtpZih0JiZ0IT09J+KAlCcpZWwucmVtb3ZlQXR0cmlidXRlKCdkYXRhLWVtcHR5Jyk7ZWxzZSBlbC5zZXRBdHRyaWJ1dGUoJ2RhdGEtZW1wdHknLCcxJyk7fQpmdW5jdGlvbiByZXN0b3JlU2F2ZWQoKXtBTExLLmZvckVhY2goZnVuY3Rpb24oayl7dmFyIHY9bHNHZXQoayk7aWYodiE9bnVsbClzZXRUZXh0KGssdik7fSk7dmFyIGE9bHNHZXQoJ2FjdGlvbnMnKTtpZihhIT1udWxsKSQoJ2FjdGlvbkxpc3QnKS5pbm5lckhUTUw9YTt9CmZ1bmN0aW9uIGJ1aWxkU25hcCgpewogIHZhciB3aW49d2luZG93TW9udGhzKCkscHJldj1wcmV2TW9udGhzKHdpbik7CiAgdmFyIEw9bUxhYmVsKHdpblswXSkrKHdpbi5sZW5ndGg+MT8n4oCTJyttTGFiZWwod2luW3dpbi5sZW5ndGgtMV0pOicnKTsKICB2YXIgcz0nU2ljb3JhIENvbnN1bHRpbmcg4oCUICcrTCsnIHZzICcrKCQoJ2ZfY21wJykudmFsdWU9PT0neWVhcic/J3ByZXZpb3VzIHllYXInOidwcmV2aW91cyBwZXJpb2QnKSsnLlxuJzsKICBzKz0nR0E0OiBzZXNzaW9ucyAnK2ZtdChzdW1NZXRyaWMod2luLDApKSsnIHZzICcrZm10KHN1bU1ldHJpYyhwcmV2LDApKSsnOyB1c2VycyAnK2ZtdChzdW1NZXRyaWMod2luLDEpKSsnOyBrZXkgZXZlbnRzICcrZm10KHN1bU1ldHJpYyh3aW4sNCkpKycuXG4nOwogIHZhciBnYz13aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7cmV0dXJuIGErZ2Fkc01vbnRoQWdnKG0pWzJdO30sMCksZ3Y9d2luLnJlZHVjZShmdW5jdGlvbihhLG0pe3JldHVybiBhK2dhZHNNb250aEFnZyhtKVszXTt9LDApOwogIHMrPSdHb29nbGUgQWRzOiBzcGVuZCAnK21vbmV5KGdjKSsnLCBjb252ZXJzaW9ucyAnK2ZtdChndikrJywgQ1BBICcrKGd2P21vbmV5KGdjL2d2KTonbi9hJykrJy5cbic7CiAgdmFyIGdjbD13aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7cmV0dXJuIGErKChEQVRBLmdzYyYmREFUQS5nc2MuZGF0YSYmREFUQS5nc2MuZGF0YVttXSYmREFUQS5nc2MuZGF0YVttXVswXSl8fDApO30sMCk7CiAgcys9J1NlYXJjaCBDb25zb2xlOiBjbGlja3MgJytmbXQoZ2NsKSsnLlxuJzsKICB2YXIgc209KERBVEEuZ2hsJiZEQVRBLmdobC5zdW1tYXJ5KXx8e307dmFyIGZvcm1zPShEQVRBLmdobCYmREFUQS5naGwuZm9ybXMpfHxbXTsKICBzKz0nR29IaWdoTGV2ZWw6ICcrZm10KHNtLmZvcm1GaWxsc3x8MCkrJyBmb3JtIGZpbGxzIGFjcm9zcyAnK2Zvcm1zLmxlbmd0aCsnIGZvcm1zICgnK2Zvcm1zLnNsaWNlKDAsNCkubWFwKGZ1bmN0aW9uKGYpe3JldHVybiBmLm5hbWUrJyAnK2YudG90YWw7fSkuam9pbignLCAnKSsnKS4gT3BlbiBwaXBlbGluZSAnK21vbmV5KHNtLm9wZW5WYWx1ZXx8MCkrJywgd29uICcrbW9uZXkoc20ud29uVmFsdWV8fDApKycgKCcrKHNtLndvbkNvdW50fHwwKSsnIGRlYWxzKSwgJysoc20ubG9zdENvdW50fHwwKSsnIGxvc3QuIFNvdXJjZXM6ICcrT2JqZWN0LmtleXMoREFUQS5naGwmJkRBVEEuZ2hsLnNvdXJjZXN8fHt9KS5zbGljZSgwLDUpLm1hcChmdW5jdGlvbihrKXtyZXR1cm4gcHJldHR5U3JjKGspKycgJytEQVRBLmdobC5zb3VyY2VzW2tdO30pLmpvaW4oJywgJykrJy4nOwogIHdpbmRvdy5fX1NOQVA9czsKICB3aW5kb3cuX19BTlNJRz0kKCdmX3RmJykudmFsdWUrJ3wnKyQoJ2ZfY21wJykudmFsdWU7Cn0KZnVuY3Rpb24gcmVuZGVyQWN0aW9ucyh2YWwpe3ZhciBlbD0kKCdhY3Rpb25MaXN0Jyk7aWYoQXJyYXkuaXNBcnJheSh2YWwpJiZ2YWwubGVuZ3RoKXtlbC5pbm5lckhUTUw9JzxvbCBzdHlsZT0ibWFyZ2luOjA7cGFkZGluZy1sZWZ0OjE4cHgiPicrdmFsLm1hcChmdW5jdGlvbihhKXtyZXR1cm4gJzxsaSBzdHlsZT0ibWFyZ2luOjAgMCA2cHgiPicrZXNjKGEpKyc8L2xpPic7fSkuam9pbignJykrJzwvb2w+JztlbC5yZW1vdmVBdHRyaWJ1dGUoJ2RhdGEtZW1wdHknKTtsc1NldCgnYWN0aW9ucycsZWwuaW5uZXJIVE1MKTt9ZWxzZSBpZih0eXBlb2YgdmFsPT09J3N0cmluZycpe2VsLnRleHRDb250ZW50PXZhbDtlbC5zZXRBdHRyaWJ1dGUoJ2RhdGEtZW1wdHknLCcxJyk7fX0KZnVuY3Rpb24gZ2VuZXJhdGVBbmFseXNpcyhmb3JjZSl7CiAgaWYoYW5CdXN5KXJldHVybjsKICBpZighZm9yY2Upe3ZhciBhbnk9QUxMSy5zb21lKGZ1bmN0aW9uKGspe3JldHVybiBsc0dldChrKSE9bnVsbDt9KTtpZihhbnkpe3Jlc3RvcmVTYXZlZCgpO3JldHVybjt9fQogIGFuQnVzeT10cnVlO3ZhciBidG49JCgnYW5CdG4nKTtpZihidG4pe2J0bi5kaXNhYmxlZD10cnVlO2J0bi50ZXh0Q29udGVudD0nQW5hbHl6aW5n4oCmJzt9CiAgQUxMSy5mb3JFYWNoKGZ1bmN0aW9uKGspe3NldFRleHQoaywnQW5hbHl6aW5n4oCmJyk7fSk7cmVuZGVyQWN0aW9ucygnQW5hbHl6aW5n4oCmJyk7CiAgZmV0Y2goJy9hcGkvYW5hbHl6ZScse21ldGhvZDonUE9TVCcsaGVhZGVyczp7J2NvbnRlbnQtdHlwZSc6J2FwcGxpY2F0aW9uL2pzb24nfSxib2R5OkpTT04uc3RyaW5naWZ5KHtjb250ZXh0OndpbmRvdy5fX1NOQVB8fCcnfSl9KQogIC50aGVuKGZ1bmN0aW9uKHIpe3JldHVybiByLmpzb24oKS50aGVuKGZ1bmN0aW9uKGope3JldHVybntvazpyLm9rLGo6an07fSk7fSkKICAudGhlbihmdW5jdGlvbih4KXtpZigheC5vayl0aHJvdyBuZXcgRXJyb3IoKHguaiYmeC5qLmVycm9yKXx8J2Vycm9yJyk7dmFyIGo9eC5qOwogICAgQUxMSy5mb3JFYWNoKGZ1bmN0aW9uKGspe3ZhciB0PShrPT09J3N1bW1hcnknP2ouc3VtbWFyeTpqW2tdKXx8J05vIG5vdGFibGUgY2hhbmdlIGluIHRoaXMgdmlldy4nO3NldFRleHQoayx0KTtsc1NldChrLHQpO30pOwogICAgcmVuZGVyQWN0aW9ucyhBcnJheS5pc0FycmF5KGouYWN0aW9ucyk/ai5hY3Rpb25zOm51bGwpOwogIH0pCiAgLmNhdGNoKGZ1bmN0aW9uKCl7dmFyIG1zZz0nQW5hbHlzaXMgcnVucyBvbiB0aGUgbGl2ZSBkYXNoYm9hcmQgKG5lZWRzIHRoZSBzZXJ2ZXIgY29ubmVjdGlvbikuJztBTExLLmZvckVhY2goZnVuY3Rpb24oayl7c2V0VGV4dChrLG1zZyk7fSk7cmVuZGVyQWN0aW9ucyhtc2cpO30pCiAgLmZpbmFsbHkoZnVuY3Rpb24oKXthbkJ1c3k9ZmFsc2U7aWYoYnRuKXtidG4uZGlzYWJsZWQ9ZmFsc2U7YnRuLnRleHRDb250ZW50PSdSZWdlbmVyYXRlIGFuYWx5c2lzJzt9fSk7Cn0KCi8vIC0tLS0tLS0tLS0gUSZBIC0tLS0tLS0tLS0KZnVuY3Rpb24gYXNrKCl7dmFyIHE9JCgnYXNrUScpLnZhbHVlLnRyaW0oKTtpZighcSlyZXR1cm47JCgnYXNrQW5zJykudGV4dENvbnRlbnQ9J1RoaW5raW5n4oCmJzsKICBmZXRjaCgnL2FwaS9hc2snLHttZXRob2Q6J1BPU1QnLGhlYWRlcnM6eydjb250ZW50LXR5cGUnOidhcHBsaWNhdGlvbi9qc29uJ30sYm9keTpKU09OLnN0cmluZ2lmeSh7cXVlc3Rpb246cSxjb250ZXh0OndpbmRvdy5fX1NOQVB8fCcnfSl9KQogIC50aGVuKGZ1bmN0aW9uKHIpe3JldHVybiByLmpzb24oKTt9KS50aGVuKGZ1bmN0aW9uKGopeyQoJ2Fza0FucycpLnRleHRDb250ZW50PWouYW5zd2VyfHxqLmVycm9yfHwnTm8gYW5zd2VyLic7fSkKICAuY2F0Y2goZnVuY3Rpb24oKXskKCdhc2tBbnMnKS50ZXh0Q29udGVudD0nU29tZXRoaW5nIHdlbnQgd3JvbmcuJzt9KTt9CgovLyAtLS0tLS0tLS0tIHJlbmRlciBvcmNoZXN0cmF0aW9uIC0tLS0tLS0tLS0KZnVuY3Rpb24gcmVuZGVyKCl7CiAgYnVpbGRTbmFwKCk7CiAgJCgnd2luTGFiZWwnKS50ZXh0Q29udGVudD13aW5kb3cuX19TTkFQLnNwbGl0KCdcbicpWzBdLnJlcGxhY2UoJ1NpY29yYSBDb25zdWx0aW5nIOKAlCAnLCcnKTsKICByZW5kZXJLUElzKCk7cmVuZGVyR0E0KCk7cmVuZGVyR2FkcygpO3JlbmRlckdTQygpO3JlbmRlckZvcm1GaWx0ZXIoKTtyZW5kZXJHSExGb3JtcygpO3JlbmRlckpvdXJuZXkoKTtyZW5kZXJQaXBlcygpOwogICQoJ2dlbkF0JykudGV4dENvbnRlbnQ9REFUQS5nZW5lcmF0ZWRBdD8oJ1VwZGF0ZWQgJytuZXcgRGF0ZShEQVRBLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygnZW4tVVMnLHttb250aDonc2hvcnQnLGRheTonbnVtZXJpYycsaG91cjonbnVtZXJpYycsbWludXRlOicyLWRpZ2l0J30pKTonJzsKICAkKCdidWlsZE5vJykudGV4dENvbnRlbnQ9J0J1aWxkICcrKERBVEEuYnVpbGR8fCc/Jyk7CiAgJCgnbGl2ZUxhYmVsJykudGV4dENvbnRlbnQ9KERBVEEubW9udGhzJiZEQVRBLm1vbnRocy5sZW5ndGgpPydMaXZlIGRhdGEnOidTYW1wbGUgZGF0YSc7CiAgLy8gYW5hbHlzaXM6IHJlZ2VuZXJhdGUgb24gd2luZG93IGNoYW5nZQogIGlmKHdpbmRvdy5fX0FOU0lHIT09d2luZG93Ll9fQU5TSUdfbGFzdCl7d2luZG93Ll9fQU5TSUdfbGFzdD13aW5kb3cuX19BTlNJRztpZih3aW5kb3cuX19hbkluaXQpZ2VuZXJhdGVBbmFseXNpcyhmYWxzZSk7fQp9CiQoJ2ZfdGYnKS5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLHJlbmRlcik7CiQoJ2ZfY21wJykuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJyxyZW5kZXIpOwokKCdhbkJ0bicpLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJyxmdW5jdGlvbigpe2lmKGNvbmZpcm0oJ1JlZ2VuZXJhdGUgYWxsIGFuYWx5c2lzIGZyb20gdGhlIGxpdmUgZGF0YT8gVGhpcyByZXBsYWNlcyB5b3VyIGVkaXRzIGZvciB0aGlzIHZpZXcuJykpZ2VuZXJhdGVBbmFseXNpcyh0cnVlKTt9KTsKJCgnYXNrR28nKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsYXNrKTsKJCgnYXNrUScpLmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLGZ1bmN0aW9uKGUpe2lmKGUua2V5PT09J0VudGVyJylhc2soKTt9KTsKCnJlbmRlcigpOwpnZW5lcmF0ZUFuYWx5c2lzKGZhbHNlKTsKd2luZG93Ll9fYW5Jbml0PXRydWU7CgovLyBDaGFydC5qcyBmYWxsYmFjayBpZiB0aGUgc2FtZS1vcmlnaW4gZmlsZSBtaXNzZWQKaWYodHlwZW9mIENoYXJ0PT09J3VuZGVmaW5lZCcpe3ZhciBjcz1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtjcy5zcmM9J2h0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vY2hhcnQuanNANC40LjEvZGlzdC9jaGFydC51bWQubWluLmpzJztjcy5vbmxvYWQ9ZnVuY3Rpb24oKXtIQVNDSEFSVD10cnVlO3RyeXtyZW5kZXIoKTt9Y2F0Y2goZSl7fX07ZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChjcyk7fQo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
app.get('/', async (req, res) => {
  let data; try { data = await getData(); } catch (e) { data = cache.data || SNAPSHOT; }
  const inject = 'window.__DASH_DATA__=' + JSON.stringify(data) + ';';
  const html = Buffer.from(INDEX_B64, 'base64').toString('utf8').replace('/*__DATA__*/', inject);
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});
app.get('/api/ready', (req, res) => res.json({ ready: isFresh() }));

const analysisCache = new Map();
app.post('/api/analyze', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set on the server.' });
  const { context } = req.body || {};
  if (!context) return res.status(400).json({ error: 'Missing context.' });
  if (analysisCache.has(context)) return res.json(analysisCache.get(context));
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content:
        `You are a senior marketing analyst at Astoria Advertising Company reviewing Sicora Consulting's live performance `
        + `data for the current reporting window. Using ONLY the data below, write a brief marketing read for each `
        + `channel: what the numbers indicate and the single most useful next action. The "ghl" read covers the GoHighLevel CRM: `
        + `focus on form submissions and their marketing source, which forms drive contacts, the form-filler journey (transactions, `
        + `memberships, pipeline stage), and pipeline value/win rate. Be specific with figures, plain spoken but sharp, like a senior `
        + `marketing strategist: tie each metric to a likely cause and a concrete next move, name the trade-off or quantify the `
        + `opportunity where you can, and skip generic filler. No jargon, no markdown, 3 to 4 sentences each. Do not use em dashes.\n\n${context}\n\n`
        + `Respond with ONLY a JSON object (no preamble, no code fences) with exactly these keys: `
        + `"ga4", "gads", "gsc", "ghl" (each a 2 to 3 sentence string), `
        + `"summary" (a 2 to 3 sentence executive takeaway across all channels that speaks to leads, pipeline and revenue, not just sessions), and `
        + `"actions" (an array of 4 to 6 short, specific, prioritized action item strings drawn from across all channels, `
        + `each starting with a verb and referencing concrete figures or names where useful, most important first). `
        + `If a channel shows no data, give a one sentence note that it is not yet reporting.` }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j });
    let txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    let out = null;
    try { out = JSON.parse(txt); } catch (_) {}
    if (!out) { const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a >= 0 && b > a) { try { out = JSON.parse(txt.slice(a, b + 1)); } catch (_) {} } }
    if (!out || typeof out !== 'object' || (!out.summary && !out.ga4)) {
      return res.status(502).json({ error: 'The analysis came back malformed (likely truncated). Click Regenerate analysis to try again.' });
    }
    analysisCache.set(context, out);
    if (analysisCache.size > 50) analysisCache.delete(analysisCache.keys().next().value);
    res.json(out);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/ask', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set on the server.' });
  const { question, context } = req.body || {};
  if (!question) return res.status(400).json({ error: 'Missing question.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: 'user', content:
        `You are a marketing analyst for Sicora Consulting. Answer the question using ONLY the data below. Be concise and specific with figures. No markdown, no em dashes.\n\nDATA:\n${context || ''}\n\nQUESTION: ${question}` }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j });
    const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ answer: txt });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---- listen ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sicora dashboard on http://localhost:' + PORT));
warm();
loadChartJs();
export default app;
