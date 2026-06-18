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
  'robert@sicoraconsulting.com': process.env.PW_ROBERT,
  'magnus@sicoraconsulting.com': process.env.PW_MAGNUS,
  'lorri@sicoraconsulting.com':  process.env.PW_LORRI,
  'lorrimguimond@gmail.com':     process.env.PW_LORRI_GMAIL,
  'gus@astoriaadvertising.co':   process.env.PW_GUS,
  'jason@astoriaadvertising.co': process.env.PW_JASON,
};
const AUTH_ENABLED = true; // always gate this client report
const AUTH_SALT = process.env.AUTH_SALT || 'sicora-dash-v1';
const BUILD = 4; // bump every deploy; surfaced in the footer and /api/health

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
  // Key events by name (auto-discovered): `conversions` is the key-event count metric,
  // so any event_name with conversions>0 is a key event. Pulled sequentially to respect GA4 rate limits.
  const keRows = await Q(['year_month','event_name','conversions']);
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
  // Top key events by total count → ordered keNames + per-month counts (ke[ym] = [n per keNames index]).
  const keTot = {};
  for (const r of (keRows || [])) { const n = r.event_name, c = +r.conversions || 0; if (!n || c <= 0) continue; keTot[n] = (keTot[n] || 0) + c; }
  const keNames = Object.entries(keTot).sort((a,b)=>b[1]-a[1]).slice(0, 8).map(x=>x[0]);
  const keMap = {};
  for (const r of (keRows || [])) { const ym = normYM(r.year_month), i = keNames.indexOf(r.event_name), c = +r.conversions || 0; if (i < 0 || !ym || c <= 0) continue; (keMap[ym] = keMap[ym] || new Array(keNames.length).fill(0))[i] += c; }
  const monthsArr = [...months].sort();
  const nowYM = new Date().toISOString().slice(0,7).replace('-','');
  const complete = monthsArr.filter(m => m < nowYM);
  const current = complete.length ? complete[complete.length-1] : monthsArr[monthsArr.length-1];
  return { channels: [...chans].sort(), months: monthsArr, chm, totals,
           regNames: R.names, reg: R.map, cityNames: Y.names, city: Y.map,
           keNames, ke: keMap, current };
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
const SNAPSHOT_B64="ewogICJjaGFubmVscyI6IFsiRGlyZWN0IiwgIk9yZ2FuaWMgU2VhcmNoIiwgIlBhaWQgU2VhcmNoIiwgIlJlZmVycmFsIiwgIkVtYWlsIiwgIk9yZ2FuaWMgU29jaWFsIiwgIlBhaWQgT3RoZXIiLCAiQ3Jvc3MtbmV0d29yayIsICJVbmFzc2lnbmVkIl0sCiAgIm1vbnRocyI6IFsiMjAyNjAxIiwgIjIwMjYwMiIsICIyMDI2MDMiLCAiMjAyNjA0IiwgIjIwMjYwNSJdLAogICJjdXJyZW50IjogIjIwMjYwNSIsCiAgImNobSI6IHsKICAgICIyMDI2MDEiOiB7IkRpcmVjdCI6IFsyOTgwLCAyODIwLCA3MTAwLCAxODIwMCwgMzFdLCAiT3JnYW5pYyBTZWFyY2giOiBbMTA0MCwgODAwLCAyNjAwLCA2MTAwLCAyMl0sICJQYWlkIFNlYXJjaCI6IFs3NjAsIDY2MCwgMTcwMCwgNDIwMCwgMjRdLCAiUmVmZXJyYWwiOiBbODAsIDYwLCAxOTAsIDQyMCwgMl19LAogICAgIjIwMjYwMiI6IHsiRGlyZWN0IjogWzMxMjAsIDI5NjAsIDc0MDAsIDE5MTAwLCAzM10sICJPcmdhbmljIFNlYXJjaCI6IFsxMDkwLCA4NDAsIDI3MDAsIDYzMDAsIDI0XSwgIlBhaWQgU2VhcmNoIjogWzgwMCwgNjkwLCAxODAwLCA0NDAwLCAyNl0sICJSZWZlcnJhbCI6IFs4NSwgNjQsIDIwMCwgNDQwLCAyXX0sCiAgICAiMjAyNjAzIjogeyJEaXJlY3QiOiBbMzM3OCwgMzI0MywgODEwMCwgMjA4MDAsIDM4XSwgIk9yZ2FuaWMgU2VhcmNoIjogWzExOTAsIDkxMSwgMjkwMCwgNjkwMCwgMjddLCAiUGFpZCBTZWFyY2giOiBbODY3LCA3NTMsIDE5NTAsIDQ3MDAsIDMxXSwgIlJlZmVycmFsIjogWzg5LCA1MywgMjEwLCA0NzAsIDNdLCAiVW5hc3NpZ25lZCI6IFsxOTAsIDE5MCwgNDEwLCA5ODAsIDFdfSwKICAgICIyMDI2MDQiOiB7IkRpcmVjdCI6IFs2NjIsIDU5NSwgMTcwMCwgNDEwMCwgMTJdLCAiT3JnYW5pYyBTZWFyY2giOiBbMTExOCwgNzg3LCAyODAwLCA2NzAwLCAyNV0sICJQYWlkIFNlYXJjaCI6IFs4MDksIDcwNCwgMTg1MCwgNDUwMCwgMjldLCAiUmVmZXJyYWwiOiBbOTksIDY5LCAyMzAsIDUxMCwgM119LAogICAgIjIwMjYwNSI6IHsiRGlyZWN0IjogWzcwMCwgNjM0LCAxNzUwLCA0MjAwLCAxNF0sICJPcmdhbmljIFNlYXJjaCI6IFsxMDkwLCA3ODEsIDI3NTAsIDY2MDAsIDI0XSwgIlBhaWQgU2VhcmNoIjogWzk4NywgODYzLCAyMTAwLCA1MDAwLCA0OV0sICJSZWZlcnJhbCI6IFs4MywgNjMsIDIwMCwgNDUwLCAyXX0KICB9LAogICJyZWdOYW1lcyI6IFsiQ2FsaWZvcm5pYSIsICJOZXcgWW9yayIsICJUZXhhcyIsICJNaW5uZXNvdGEiLCAiT3RoZXIiXSwKICAicmVnIjogewogICAgIjIwMjYwNSI6IHsiQ2FsaWZvcm5pYSI6IFs1MjAsIDZdLCAiTmV3IFlvcmsiOiBbNDEwLCA1XSwgIlRleGFzIjogWzM2MCwgNF0sICJNaW5uZXNvdGEiOiBbMzAwLCA4XSwgIk90aGVyIjogWzEyNzAsIDI2XX0KICB9LAogICJjaXR5TmFtZXMiOiBbIk1pbm5lYXBvbGlzIiwgIkNoaWNhZ28iLCAiTmV3IFlvcmsiLCAiT3RoZXIiXSwKICAiY2l0eSI6IHsKICAgICIyMDI2MDUiOiB7Ik1pbm5lYXBvbGlzIjogWzI4MCwgN10sICJDaGljYWdvIjogWzE5MCwgM10sICJOZXcgWW9yayI6IFsxNzAsIDJdLCAiT3RoZXIiOiBbMjIyMCwgMzddfQogIH0sCiAgImtlTmFtZXMiOiBbImNvbnRhY3RfZm9ybV9zdWJtaXNzaW9uIiwgImdobF9mb3JtX3N1Ym1pdCIsICJjaGVja2xpc3RfZG93bmxvYWQiLCAid2hpdGVwYXBlcl9mb3JtX3N1Ym1pc3Npb24iLCAiZ3JhYl90aGVfaGVsbV9jb3Vyc2VfcmVnaXN0cmF0aW9uX2Zvcm0iLCAiZ3JhYl90aGVfaGVsbV9ib29rX3ByZXZpZXdfZm9ybSJdLAogICJrZSI6IHsKICAgICIyMDI2MDEiOiBbMjIsIDE4LCA3LCAzLCAyLCAyXSwKICAgICIyMDI2MDIiOiBbMjYsIDIwLCA4LCA0LCAzLCAyXSwKICAgICIyMDI2MDMiOiBbMzAsIDI0LCA5LCA1LCAzLCAzXSwKICAgICIyMDI2MDQiOiBbMzEsIDI2LCAxMCwgNSwgNCwgM10sCiAgICAiMjAyNjA1IjogWzMxLCAyOSwgMTAsIDUsIDUsIDNdCiAgfSwKICAiZ2FkcyI6IHsKICAgICJtb250aHMiOiBbIjIwMjYwMyIsICIyMDI2MDQiLCAiMjAyNjA1Il0sCiAgICAiY2FtcGFpZ25zIjogWyJTZWFyY2ggLSBJbnNpZ2h0cyBEaXNjb3ZlcnkiLCAiU2VhcmNoIC0gTGVhZGVyc2hpcCBUcmFpbmluZyIsICJQTWF4IC0gQnJhbmQiXSwKICAgICJkYXRhIjogewogICAgICAiMjAyNjAzIjogeyJTZWFyY2ggLSBJbnNpZ2h0cyBEaXNjb3ZlcnkiOiBbNTIwLCA5ODAwLCAxODUwLjUsIDE4XSwgIlNlYXJjaCAtIExlYWRlcnNoaXAgVHJhaW5pbmciOiBbMjQwLCA1MjAwLCA5ODAuMiwgOF0sICJQTWF4IC0gQnJhbmQiOiBbODUsIDIxMDAsIDI1OC43OSwgM119LAogICAgICAiMjAyNjA0IjogeyJTZWFyY2ggLSBJbnNpZ2h0cyBEaXNjb3ZlcnkiOiBbNDcwLCA5MjAwLCAxOTIwLjQsIDE3XSwgIlNlYXJjaCAtIExlYWRlcnNoaXAgVHJhaW5pbmciOiBbMjIwLCA0OTAwLCAxMDEwLjUsIDldLCAiUE1heCAtIEJyYW5kIjogWzc1LCAxOTUwLCAzMDMuOCwgM119LAogICAgICAiMjAyNjA1IjogeyJTZWFyY2ggLSBJbnNpZ2h0cyBEaXNjb3ZlcnkiOiBbNjAwLCAxMDQwMCwgMjE1MC4wLCAzMF0sICJTZWFyY2ggLSBMZWFkZXJzaGlwIFRyYWluaW5nIjogWzI4MCwgNTYwMCwgMTE4MC4wLCAxNF0sICJQTWF4IC0gQnJhbmQiOiBbOTAsIDIzMDAsIDMxNy4wLCA1XX0KICAgIH0sCiAgICAiY29udiI6IHsKICAgICAgIm1vbnRocyI6IFsiMjAyNjAzIiwgIjIwMjYwNCIsICIyMDI2MDUiXSwKICAgICAgImJ5TW9udGgiOiB7CiAgICAgICAgIjIwMjYwMyI6IHsiQXNzZXNzbWVudCBQdXJjaGFzZSI6IDEyLCAiQ29udGFjdCBGb3JtIjogMTEsICJQaG9uZSBDYWxsIjogNn0sCiAgICAgICAgIjIwMjYwNCI6IHsiQXNzZXNzbWVudCBQdXJjaGFzZSI6IDEzLCAiQ29udGFjdCBGb3JtIjogMTAsICJQaG9uZSBDYWxsIjogNn0sCiAgICAgICAgIjIwMjYwNSI6IHsiQXNzZXNzbWVudCBQdXJjaGFzZSI6IDI0LCAiQ29udGFjdCBGb3JtIjogMTYsICJQaG9uZSBDYWxsIjogOX0KICAgICAgfQogICAgfQogIH0sCiAgImdzYyI6IHsKICAgICJtb250aHMiOiBbIjIwMjYwMSIsICIyMDI2MDIiLCAiMjAyNjAzIiwgIjIwMjYwNCIsICIyMDI2MDUiXSwKICAgICJkYXRhIjogewogICAgICAiMjAyNjAxIjogWzM5MCwgNDQyMDAsIDkuMV0sCiAgICAgICIyMDI2MDIiOiBbNDA1LCA0NTgwMCwgOC45XSwKICAgICAgIjIwMjYwMyI6IFs0MjAsIDQ3NjAwLCA4LjddLAogICAgICAiMjAyNjA0IjogWzQyOCwgNDg5MDAsIDguNl0sCiAgICAgICIyMDI2MDUiOiBbNDM1LCA0OTgxNiwgOC41Ml0KICAgIH0sCiAgICAicXVlcmllcyI6IHsKICAgICAgIjIwMjYwNSI6IHsKICAgICAgICAiaW5zaWdodHMgZGlzY292ZXJ5IjogWzEyMCwgODQwMCwgNC4yXSwKICAgICAgICAibGVhZGVyc2hpcCB0cmFpbmluZyI6IFs3OCwgNjEwMCwgNy4xXSwKICAgICAgICAiZW1wbG95ZWUgZW5nYWdlbWVudCI6IFs1NCwgNTIwMCwgOS44XSwKICAgICAgICAic2ljb3JhIGNvbnN1bHRpbmciOiBbOTIsIDE4MDAsIDEuNF0sCiAgICAgICAgInRlYW0gZWZmZWN0aXZlbmVzcyBhc3Nlc3NtZW50IjogWzMxLCAzOTAwLCAxMi4zXQogICAgICB9CiAgICB9CiAgfSwKICAiZ2hsIjogewogICAgIm1vbnRocyI6IFsiMjAyNjAxIiwgIjIwMjYwMiIsICIyMDI2MDMiLCAiMjAyNjA0IiwgIjIwMjYwNSJdLAogICAgImZvcm1zIjogWwogICAgICB7Im5hbWUiOiAiQ29udGFjdCBVcyIsICJ0b3RhbCI6IDg2LCAiY2hhbm5lbHMiOiB7Ik9SR0FOSUNfU0VBUkNIIjogMzQsICJQQUlEX1NFQVJDSCI6IDIyLCAiRElSRUNUX1RSQUZGSUMiOiAyMCwgIlJFRkVSUkFMUyI6IDEwfX0sCiAgICAgIHsibmFtZSI6ICI0IENvbG9ycyBvZiBJbnNpZ2h0cyBDb250YWN0IiwgInRvdGFsIjogNjQsICJjaGFubmVscyI6IHsiUEFJRF9TRUFSQ0giOiAzOCwgIk9SR0FOSUNfU0VBUkNIIjogMTQsICJESVJFQ1RfVFJBRkZJQyI6IDEyfX0sCiAgICAgIHsibmFtZSI6ICJQUEMgLSBJbnNpZ2h0cyBEaXNjb3ZlcnkgTGFuZGluZyBQYWdlIiwgInRvdGFsIjogNTIsICJjaGFubmVscyI6IHsiUEFJRF9TRUFSQ0giOiA0OSwgIkRJUkVDVF9UUkFGRklDIjogM319LAogICAgICB7Im5hbWUiOiAibWVtYmVyc2hpcCIsICJ0b3RhbCI6IDI4LCAiY2hhbm5lbHMiOiB7IkRJUkVDVF9UUkFGRklDIjogMTYsICJPUkdBTklDX1NFQVJDSCI6IDgsICJFTUFJTF9NQVJLRVRJTkciOiA0fX0sCiAgICAgIHsibmFtZSI6ICJDYWxlbmRseSIsICJ0b3RhbCI6IDE5LCAiY2hhbm5lbHMiOiB7IkRJUkVDVF9UUkFGRklDIjogMTIsICJPUkdBTklDX1NFQVJDSCI6IDd9fQogICAgXSwKICAgICJieU1vbnRoIjogewogICAgICAiMjAyNjAxIjogeyJDb250YWN0IFVzIjogMTQsICI0IENvbG9ycyBvZiBJbnNpZ2h0cyBDb250YWN0IjogMTAsICJQUEMgLSBJbnNpZ2h0cyBEaXNjb3ZlcnkgTGFuZGluZyBQYWdlIjogOCwgIm1lbWJlcnNoaXAiOiA1LCAiQ2FsZW5kbHkiOiAzfSwKICAgICAgIjIwMjYwMiI6IHsiQ29udGFjdCBVcyI6IDE2LCAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCI6IDEyLCAiUFBDIC0gSW5zaWdodHMgRGlzY292ZXJ5IExhbmRpbmcgUGFnZSI6IDksICJtZW1iZXJzaGlwIjogNSwgIkNhbGVuZGx5IjogNH0sCiAgICAgICIyMDI2MDMiOiB7IkNvbnRhY3QgVXMiOiAxOCwgIjQgQ29sb3JzIG9mIEluc2lnaHRzIENvbnRhY3QiOiAxMywgIlBQQyAtIEluc2lnaHRzIERpc2NvdmVyeSBMYW5kaW5nIFBhZ2UiOiAxMSwgIm1lbWJlcnNoaXAiOiA2LCAiQ2FsZW5kbHkiOiA0fSwKICAgICAgIjIwMjYwNCI6IHsiQ29udGFjdCBVcyI6IDE5LCAiNCBDb2xvcnMgb2YgSW5zaWdodHMgQ29udGFjdCI6IDE0LCAiUFBDIC0gSW5zaWdodHMgRGlzY292ZXJ5IExhbmRpbmcgUGFnZSI6IDEyLCAibWVtYmVyc2hpcCI6IDYsICJDYWxlbmRseSI6IDR9LAogICAgICAiMjAyNjA1IjogeyJDb250YWN0IFVzIjogMTksICI0IENvbG9ycyBvZiBJbnNpZ2h0cyBDb250YWN0IjogMTUsICJQUEMgLSBJbnNpZ2h0cyBEaXNjb3ZlcnkgTGFuZGluZyBQYWdlIjogMTIsICJtZW1iZXJzaGlwIjogNiwgIkNhbGVuZGx5IjogNH0KICAgIH0sCiAgICAic291cmNlcyI6IHsiT1JHQU5JQ19TRUFSQ0giOiA3NywgIlBBSURfU0VBUkNIIjogMTA5LCAiRElSRUNUX1RSQUZGSUMiOiA2MywgIlJFRkVSUkFMUyI6IDIwLCAiRU1BSUxfTUFSS0VUSU5HIjogNCwgIlBBSURfU09DSUFMIjogOCwgIlNPQ0lBTF9NRURJQSI6IDZ9LAogICAgInBpcGVsaW5lcyI6IFsKICAgICAgeyJpZCI6ICJLaFJHbldaQW9seUVhSmR3MnhTayIsICJuYW1lIjogIlBQQyArIFNFTyIsICJzdGFnZXMiOiBbCiAgICAgICAgeyJuYW1lIjogIk5ldyBMZWFkIiwgIm4iOiA0MiwgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIkluaXRpYWwgT3V0cmVhY2ggU2VudCIsICJuIjogMjgsICJ2YWx1ZSI6IDB9LAogICAgICAgIHsibmFtZSI6ICJEaXNjb3ZlcnkgQ2FsbCBTY2hlZHVsZWQiLCAibiI6IDE4LCAidmFsdWUiOiA1NDAwMH0sCiAgICAgICAgeyJuYW1lIjogIkRpc2NvdmVyeSBDYWxsIENvbXBsZXRlIiwgIm4iOiAxMiwgInZhbHVlIjogNDgwMDB9LAogICAgICAgIHsibmFtZSI6ICJQcm9wb3NhbCBTZW50IiwgIm4iOiA4LCAidmFsdWUiOiA2NDAwMH0sCiAgICAgICAgeyJuYW1lIjogIkNvbnRyYWN0IFNlbnQiLCAibiI6IDQsICJ2YWx1ZSI6IDM4MDAwfSwKICAgICAgICB7Im5hbWUiOiAiQ2FuY2VsbGVkIiwgIm4iOiAzLCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiQ2xvc2VkIC0gV29uIiwgIm4iOiA5LCAidmFsdWUiOiA5NjAwMH0sCiAgICAgICAgeyJuYW1lIjogIkNsb3NlZCAtIExvc3QiLCAibiI6IDE0LCAidmFsdWUiOiAwfQogICAgICBdfSwKICAgICAgeyJpZCI6ICJvN0xTeEtnU1laQTg5VktIeUROOSIsICJuYW1lIjogIlJ1bGUgb2YgNSIsICJzdGFnZXMiOiBbCiAgICAgICAgeyJuYW1lIjogIlRvdWNoIDEiLCAibiI6IDIyLCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiVG91Y2ggMiIsICJuIjogMTQsICJ2YWx1ZSI6IDB9LAogICAgICAgIHsibmFtZSI6ICJUb3VjaCAzIiwgIm4iOiA5LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiUmVzcG9uc2UgUmVjZWl2ZWQiLCAibiI6IDYsICJ2YWx1ZSI6IDB9LAogICAgICAgIHsibmFtZSI6ICJDb252ZXJzYXRpb24gQWN0aXZlIiwgIm4iOiA1LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiTWVldGluZyBTY2hlZHVsZWQiLCAibiI6IDQsICJ2YWx1ZSI6IDIyMDAwfSwKICAgICAgICB7Im5hbWUiOiAiQ2xvc2VkIC0gV29uIiwgIm4iOiAzLCAidmFsdWUiOiAyODAwMH0sCiAgICAgICAgeyJuYW1lIjogIkNsb3NlZCAtIExvc3QiLCAibiI6IDcsICJ2YWx1ZSI6IDB9CiAgICAgIF19LAogICAgICB7ImlkIjogIkNBYzRzQTlzaDE2cHNtdVpSRkl3IiwgIm5hbWUiOiAiU2VsZiBTZXJ2aWNlIiwgInN0YWdlcyI6IFsKICAgICAgICB7Im5hbWUiOiAiTmV3IExlYWQiLCAibiI6IDMxLCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiQXNzZXNzbWVudCBmb3IgUHVyY2hhc2UgRW1haWwgU2VudCIsICJuIjogMTksICJ2YWx1ZSI6IDB9LAogICAgICAgIHsibmFtZSI6ICJBc3Nlc3NtZW50IFBheW1lbnQgTWFkZSIsICJuIjogMTQsICJ2YWx1ZSI6IDQyMDB9LAogICAgICAgIHsibmFtZSI6ICJBc3Nlc3NtZW50IEluIFByb2dyZXNzIiwgIm4iOiA5LCAidmFsdWUiOiAwfSwKICAgICAgICB7Im5hbWUiOiAiQXNzZXNzbWVudCBDb21wbGV0ZSIsICJuIjogNywgInZhbHVlIjogMH0sCiAgICAgICAgeyJuYW1lIjogIlVwc2VsbCBPcHBvcnR1bml0eSIsICJuIjogMywgInZhbHVlIjogOTAwMH0sCiAgICAgICAgeyJuYW1lIjogIkNsb3NlZCAtIFdvbiIsICJuIjogNSwgInZhbHVlIjogMTI1MDB9LAogICAgICAgIHsibmFtZSI6ICJDbG9zZWQgLSBMb3N0IiwgIm4iOiA0LCAidmFsdWUiOiAwfQogICAgICBdfQogICAgXSwKICAgICJzdW1tYXJ5IjogeyJmb3JtRmlsbHMiOiAyNDksICJ0b3RhbENvbnRhY3RzIjogMzEyLCAib3BlblZhbHVlIjogMjM5MjAwLCAid29uVmFsdWUiOiAxMzY1MDAsICJ3b25Db3VudCI6IDE3LCAibG9zdENvdW50IjogMjUsICJvcGVuQ291bnQiOiAxOTh9LAogICAgImNvbnRhY3RzIjogWwogICAgICB7ImlkIjogImMxIiwgImZvcm0iOiAiQ29udGFjdCBVcyIsICJjaGFubmVsIjogIk9SR0FOSUNfU0VBUkNIIiwgImRldGFpbCI6ICJzaWNvcmFjb25zdWx0aW5nLmNvbS9jb250YWN0IiwgInltIjogIjIwMjYwNSIsICJpc0Zvcm0iOiB0cnVlLCAidHhuIjogZmFsc2UsICJ0eG5WYWwiOiAwLCAicmVjdXJyaW5nIjogZmFsc2UsICJwaXBlbGluZSI6ICJQUEMgKyBTRU8iLCAic3RhZ2UiOiAiRGlzY292ZXJ5IENhbGwgU2NoZWR1bGVkIiwgIm9wcFN0YXR1cyI6ICJvcGVuIn0sCiAgICAgIHsiaWQiOiAiYzIiLCAiZm9ybSI6ICI0IENvbG9ycyBvZiBJbnNpZ2h0cyBDb250YWN0IiwgImNoYW5uZWwiOiAiUEFJRF9TRUFSQ0giLCAiZGV0YWlsIjogIkF1dG8tdGFnZ2VkIFBQQyIsICJ5bSI6ICIyMDI2MDUiLCAiaXNGb3JtIjogdHJ1ZSwgInR4biI6IHRydWUsICJ0eG5WYWwiOiA0OTUsICJyZWN1cnJpbmciOiBmYWxzZSwgInBpcGVsaW5lIjogIlNlbGYgU2VydmljZSIsICJzdGFnZSI6ICJBc3Nlc3NtZW50IFBheW1lbnQgTWFkZSIsICJvcHBTdGF0dXMiOiAib3BlbiJ9LAogICAgICB7ImlkIjogImMzIiwgImZvcm0iOiAibWVtYmVyc2hpcCIsICJjaGFubmVsIjogIkRJUkVDVF9UUkFGRklDIiwgImRldGFpbCI6ICJzaWNvcmFjb25zdWx0aW5nLmNvbS9lbmdhZ2VtZW50IiwgInltIjogIjIwMjYwNSIsICJpc0Zvcm0iOiB0cnVlLCAidHhuIjogdHJ1ZSwgInR4blZhbCI6IDEyMDAsICJyZWN1cnJpbmciOiB0cnVlLCAicGlwZWxpbmUiOiAiU2VsZiBTZXJ2aWNlIiwgInN0YWdlIjogIkNsb3NlZCAtIFdvbiIsICJvcHBTdGF0dXMiOiAid29uIn0sCiAgICAgIHsiaWQiOiAiYzQiLCAiZm9ybSI6ICJQUEMgLSBJbnNpZ2h0cyBEaXNjb3ZlcnkgTGFuZGluZyBQYWdlIiwgImNoYW5uZWwiOiAiUEFJRF9TRUFSQ0giLCAiZGV0YWlsIjogImxnX3NlYXJjaCIsICJ5bSI6ICIyMDI2MDQiLCAiaXNGb3JtIjogdHJ1ZSwgInR4biI6IGZhbHNlLCAidHhuVmFsIjogMCwgInJlY3VycmluZyI6IGZhbHNlLCAicGlwZWxpbmUiOiAiUFBDICsgU0VPIiwgInN0YWdlIjogIlByb3Bvc2FsIFNlbnQiLCAib3BwU3RhdHVzIjogIm9wZW4ifSwKICAgICAgeyJpZCI6ICJjNSIsICJmb3JtIjogIkNvbnRhY3QgVXMiLCAiY2hhbm5lbCI6ICJQQUlEX1NFQVJDSCIsICJkZXRhaWwiOiAiQXV0by10YWdnZWQgUFBDIiwgInltIjogIjIwMjYwNCIsICJpc0Zvcm0iOiB0cnVlLCAidHhuIjogdHJ1ZSwgInR4blZhbCI6IDgwMDAsICJyZWN1cnJpbmciOiBmYWxzZSwgInBpcGVsaW5lIjogIlBQQyArIFNFTyIsICJzdGFnZSI6ICJDbG9zZWQgLSBXb24iLCAib3BwU3RhdHVzIjogIndvbiJ9LAogICAgICB7ImlkIjogImM2IiwgImZvcm0iOiAibWVtYmVyc2hpcCIsICJjaGFubmVsIjogIkVNQUlMX01BUktFVElORyIsICJkZXRhaWwiOiAiaHNfZW1haWwiLCAieW0iOiAiMjAyNjA1IiwgImlzRm9ybSI6IHRydWUsICJ0eG4iOiB0cnVlLCAidHhuVmFsIjogMTIwMCwgInJlY3VycmluZyI6IHRydWUsICJwaXBlbGluZSI6ICJTZWxmIFNlcnZpY2UiLCAic3RhZ2UiOiAiVXBzZWxsIE9wcG9ydHVuaXR5IiwgIm9wcFN0YXR1cyI6ICJvcGVuIn0sCiAgICAgIHsiaWQiOiAiYzciLCAiZm9ybSI6ICI0IENvbG9ycyBvZiBJbnNpZ2h0cyBDb250YWN0IiwgImNoYW5uZWwiOiAiT1JHQU5JQ19TRUFSQ0giLCAiZGV0YWlsIjogInNpY29yYWNvbnN1bHRpbmcuY29tLzQtY29sb3JzLW9mLWluc2lnaHRzIiwgInltIjogIjIwMjYwMyIsICJpc0Zvcm0iOiB0cnVlLCAidHhuIjogZmFsc2UsICJ0eG5WYWwiOiAwLCAicmVjdXJyaW5nIjogZmFsc2UsICJwaXBlbGluZSI6ICJSdWxlIG9mIDUiLCAic3RhZ2UiOiAiTWVldGluZyBTY2hlZHVsZWQiLCAib3BwU3RhdHVzIjogIm9wZW4ifQogICAgXSwKICAgICJjb250YWN0c0NhcHBlZCI6IDAsCiAgICAiZW1haWwiOiBudWxsCiAgfSwKICAiZ2VuZXJhdGVkQXQiOiAiMjAyNi0wNi0xN1QwMDowMDowMC4wMDBaIiwKICAiYnVpbGQiOiAxCn0K";
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
      ga4KeyEvents: d && Array.isArray(d.keNames) ? d.keNames.length : 0,
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

const INDEX_B64="PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgo8dGl0bGU+U2ljb3JhIENvbnN1bHRpbmcg4oCUIFBlcmZvcm1hbmNlIERhc2hib2FyZDwvdGl0bGU+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbSI+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nc3RhdGljLmNvbSIgY3Jvc3NvcmlnaW4+CjxsaW5rIGhyZWY9Imh0dHBzOi8vZm9udHMuZ29vZ2xlYXBpcy5jb20vY3NzMj9mYW1pbHk9RnJhdW5jZXM6b3Bzeix3Z2h0QDkuLjE0NCw1MDA7OS4uMTQ0LDYwMCZmYW1pbHk9SGFua2VuK0dyb3Rlc2s6d2dodEA0MDA7NTAwOzYwMDs3MDAmZGlzcGxheT1zd2FwIiByZWw9InN0eWxlc2hlZXQiPgo8c2NyaXB0IHNyYz0iL3ZlbmRvci9jaGFydC5qcyI+PC9zY3JpcHQ+CjxzdHlsZT4KOnJvb3R7CiAgLS1ibGFjazojMmMzZjZiOy0tY2hhcjojMjQzMTU0Oy0taW5rOiMyNDI2MmI7LS1tdXRlZDojOWE5ZWE2Oy0tZmFpbnQ6I2JjYmZjNTsKICAtLWdvbGQ6I2Y1ODQ1OTstLWdvbGQtbHQ6I2Y3OWE3NjstLXBhcGVyOiNmZmY7LS1iZzojZmZmZmZmOy0tbGluZTojZTZlYWYyOwogIC0tcG9zOiMzZjllNzQ7LS1uZWc6I2NmNmI1ZjstLWMxOiNmNTg0NTk7LS1jMjojNDA1YmE0Oy0tYzM6IzZlODI5ODstLWM0OiM4YTliN2U7LS1jNTojYjU4MzVmOy0tYzY6IzlhN2U4ZDstLWM3OiM4ODkzOWI7LS1jODojZDNjMDhmOy0tYzk6IzZmNjI4MDsKICAtLXNlcmlmOidGcmF1bmNlcycsR2VvcmdpYSxzZXJpZjstLXNhbnM6J0hhbmtlbiBHcm90ZXNrJywtYXBwbGUtc3lzdGVtLEFyaWFsLHNhbnMtc2VyaWY7Cn0KKnttYXJnaW46MDtwYWRkaW5nOjA7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e2JhY2tncm91bmQ6dmFyKC0tYmcpO2ZvbnQtZmFtaWx5OnZhcigtLXNhbnMpO2NvbG9yOnZhcigtLWluayk7Zm9udC1zaXplOjE0cHg7bGluZS1oZWlnaHQ6MS41fQoud3JhcHttYXgtd2lkdGg6MTE4MHB4O21hcmdpbjowIGF1dG87cGFkZGluZzoyMnB4IDIwcHggNjBweH0KaGVhZGVye2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LWVuZDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjtmbGV4LXdyYXA6d3JhcDtnYXA6MTZweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1saW5lKTtwYWRkaW5nLWJvdHRvbToxOHB4O21hcmdpbi1ib3R0b206OHB4fQouYnJhbmQgLnd7Zm9udC1mYW1pbHk6dmFyKC0tc2VyaWYpO2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MzBweDtsZXR0ZXItc3BhY2luZzouMDVlbTtjb2xvcjp2YXIoLS1pbmspfQouYnJhbmQgLnN1Yntmb250LXNpemU6OXB4O2xldHRlci1zcGFjaW5nOi4yNmVtO2NvbG9yOnZhcigtLW11dGVkKTttYXJnaW4tdG9wOjJweH0KLmJyYW5kIC5ydWxle2hlaWdodDoxcHg7YmFja2dyb3VuZDp2YXIoLS1nb2xkKTt3aWR0aDoxMjBweDttYXJnaW46NnB4IDAgNXB4fQouaG1ldGF7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1tdXRlZCl9Ci5obWV0YSAubGl2ZXtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NXB4O2NvbG9yOnZhcigtLXBvcyk7Zm9udC13ZWlnaHQ6NjAwfQouaG1ldGEgLmRvdHt3aWR0aDo3cHg7aGVpZ2h0OjdweDtib3JkZXItcmFkaXVzOjUwJTtiYWNrZ3JvdW5kOnZhcigtLXBvcyk7ZGlzcGxheTppbmxpbmUtYmxvY2t9Ci5jb250cm9sc3tkaXNwbGF5OmZsZXg7Z2FwOjEycHg7ZmxleC13cmFwOndyYXA7YWxpZ24taXRlbXM6ZmxleC1lbmQ7bWFyZ2luOjE4cHggMCA2cHh9Ci5jb250cm9scyBsYWJlbHtmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4wOGVtfQouY29udHJvbHMgLmZsZHtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDozcHh9Ci5jb250cm9scyAuZmxkLnJhbmdle2ZsZXgtZGlyZWN0aW9uOnJvdzthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweH0KLmNvbnRyb2xzIGlucHV0W3R5cGU9bW9udGhde2ZvbnQtZmFtaWx5OmluaGVyaXQ7Zm9udC1zaXplOjEzcHg7Y29sb3I6dmFyKC0taW5rKTtiYWNrZ3JvdW5kOnZhcigtLXBhcGVyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6N3B4O3BhZGRpbmc6NnB4IDlweH0KLmdhNGN0eHtmb250LXNpemU6MTEuNXB4O2NvbG9yOnZhcigtLW11dGVkKTttYXJnaW4tdG9wOjhweDtsaW5lLWhlaWdodDoxLjZ9Ci5nYTRjdHggYntjb2xvcjp2YXIoLS1pbmspfQpzZWxlY3R7Zm9udC1mYW1pbHk6aW5oZXJpdDtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1pbmspO2JhY2tncm91bmQ6dmFyKC0tcGFwZXIpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czo3cHg7cGFkZGluZzo3cHggMTBweH0KLmtwaXN7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE1MHB4LDFmcikpO2dhcDoxMnB4O21hcmdpbjoxNnB4IDAgOHB4fQoua3Bpe2JhY2tncm91bmQ6dmFyKC0tcGFwZXIpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTRweCAxNnB4fQoua3BpIC5sYWJ7Zm9udC1zaXplOjEwLjVweDtsZXR0ZXItc3BhY2luZzouMDhlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7Y29sb3I6dmFyKC0tbXV0ZWQpfQoua3BpIC52YWx7Zm9udC1mYW1pbHk6dmFyKC0tc2VyaWYpO2ZvbnQtc2l6ZToyNnB4O2ZvbnQtd2VpZ2h0OjYwMDttYXJnaW4tdG9wOjRweDtjb2xvcjp2YXIoLS1pbmspfQoua3BpIC5jaGd7Zm9udC1zaXplOjExLjVweDttYXJnaW4tdG9wOjNweH0KLnVwe2NvbG9yOnZhcigtLXBvcyl9LmRvd257Y29sb3I6dmFyKC0tbmVnKX0Kc2VjdGlvbntiYWNrZ3JvdW5kOnZhcigtLXBhcGVyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE4cHggMjBweDttYXJnaW4tdG9wOjE4cHh9Ci5zZWMtaHtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6YmFzZWxpbmU7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47Z2FwOjEycHg7bWFyZ2luLWJvdHRvbTo0cHh9Cmgye2ZvbnQtZmFtaWx5OnZhcigtLXNlcmlmKTtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjE4cHg7Y29sb3I6dmFyKC0taW5rKX0KLnNlYy1zdWJ7Zm9udC1zaXplOjExLjVweDtjb2xvcjp2YXIoLS1tdXRlZCl9Ci5ncmlkMntkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjEuNGZyIDFmcjtnYXA6MjBweDttYXJnaW4tdG9wOjE0cHh9Ci5ncmlkMi5ldmVue2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyfQpAbWVkaWEobWF4LXdpZHRoOjc2MHB4KXsuZ3JpZDIsLmdyaWQyLmV2ZW57Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmcn19Ci5jaGFydGJveHtwb3NpdGlvbjpyZWxhdGl2ZTtoZWlnaHQ6MjQwcHh9Ci5jaGFydGJveC5zbXtoZWlnaHQ6MjAwcHh9Ci5hbm90ZXttYXJnaW4tdG9wOjE0cHg7Ym9yZGVyLXRvcDoxcHggZGFzaGVkIHZhcigtLWxpbmUpO3BhZGRpbmctdG9wOjEycHh9Ci5hbm90ZS1oe2ZvbnQtc2l6ZToxMC41cHg7bGV0dGVyLXNwYWNpbmc6LjFlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7Y29sb3I6dmFyKC0tZ29sZCk7Zm9udC13ZWlnaHQ6NzAwO2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2FsaWduLWl0ZW1zOmNlbnRlcn0KLmFub3RlLWggLmVkaGludHtmb250LXNpemU6OXB4O2NvbG9yOnZhcigtLWZhaW50KTtsZXR0ZXItc3BhY2luZzouMDZlbTtmb250LXdlaWdodDo1MDA7dGV4dC10cmFuc2Zvcm06bm9uZX0KLmFub3RlLWJ7Zm9udC1zaXplOjEzcHg7Y29sb3I6dmFyKC0taW5rKTttYXJnaW4tdG9wOjZweDt3aGl0ZS1zcGFjZTpwcmUtd3JhcH0KLmFub3RlLWJbZGF0YS1lbXB0eV17Y29sb3I6dmFyKC0tbXV0ZWQpO2ZvbnQtc3R5bGU6aXRhbGljfQp0YWJsZXt3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTIuNXB4O21hcmdpbi10b3A6MTBweH0KdGgsdGR7dGV4dC1hbGlnbjpsZWZ0O3BhZGRpbmc6N3B4IDhweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1saW5lKX0KdGh7Zm9udC1zaXplOjEwcHg7bGV0dGVyLXNwYWNpbmc6LjA3ZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLW11dGVkKTtmb250LXdlaWdodDo2MDB9CnRkLm51bSx0aC5udW17dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXN9Ci5leGVje2JhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDE4MGRlZywjZmZmLCAjZmJmOWY0KTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWdvbGQtbHQpfQouZXhlYyBoMntjb2xvcjp2YXIoLS1nb2xkLWRrLCNhMzg4NGEpfQojZXhlY1N1bXtmb250LXNpemU6MTVweDtsaW5lLWhlaWdodDoxLjY7Y29sb3I6dmFyKC0taW5rKTt3aGl0ZS1zcGFjZTpwcmUtd3JhcH0KI2V4ZWNTdW1bZGF0YS1lbXB0eV17Y29sb3I6dmFyKC0tbXV0ZWQpO2ZvbnQtc3R5bGU6aXRhbGljfQouYWN0aW9uc3ttYXJnaW4tdG9wOjE0cHh9Ci5hY3Rpb25zIGgze2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOi4xZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLWdvbGQpO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjZweH0KI2FjdGlvbkxpc3R7Zm9udC1zaXplOjEzLjVweH0KLmZvcm1zLWZpbHRlcntkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjhweDttYXJnaW4tdG9wOjEycHh9Ci5jaGlwe2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7Zm9udC1zaXplOjEycHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjIwcHg7cGFkZGluZzo1cHggMTFweDtjdXJzb3I6cG9pbnRlcjt1c2VyLXNlbGVjdDpub25lfQouY2hpcCBpbnB1dHttYXJnaW46MH0KLmNoaXAub257YmFja2dyb3VuZDojZjZlZmRlO2JvcmRlci1jb2xvcjp2YXIoLS1nb2xkKX0KLmpyb3d7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDEzMHB4LDFmcikpO2dhcDoxMnB4O21hcmdpbi10b3A6OHB4fQouamNhcmR7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjEycHh9Ci5qY2FyZCAubGFie2ZvbnQtc2l6ZToxMHB4O2xldHRlci1zcGFjaW5nOi4wN2VtO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtjb2xvcjp2YXIoLS1tdXRlZCl9Ci5qY2FyZCAudmFse2ZvbnQtZmFtaWx5OnZhcigtLXNlcmlmKTtmb250LXNpemU6MjJweDtmb250LXdlaWdodDo2MDA7bWFyZ2luLXRvcDozcHh9Ci5waXBlc3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmciAxZnIgMWZyO2dhcDoxNnB4O21hcmdpbi10b3A6MTRweH0KQG1lZGlhKG1heC13aWR0aDo4NjBweCl7LnBpcGVze2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnJ9fQoucGlwZSBoNHtmb250LXNpemU6MTNweDtmb250LWZhbWlseTp2YXIoLS1zZXJpZik7bWFyZ2luLWJvdHRvbTo4cHh9Ci5zdGFnZXtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7bWFyZ2luOjNweCAwO2ZvbnQtc2l6ZToxMS41cHh9Ci5zdGFnZSAuYmFye2hlaWdodDoxNHB4O2JhY2tncm91bmQ6dmFyKC0tYzEpO2JvcmRlci1yYWRpdXM6M3B4O21pbi13aWR0aDoycHh9Ci5zdGFnZSAubm17ZmxleDowIDAgMTMwcHg7Y29sb3I6dmFyKC0taW5rKX0KLnN0YWdlIC5jdHtjb2xvcjp2YXIoLS1tdXRlZCk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQouYXNre21hcmdpbi10b3A6MThweDtkaXNwbGF5OmZsZXg7Z2FwOjhweH0KLmFzayBpbnB1dHtmbGV4OjE7Zm9udC1mYW1pbHk6aW5oZXJpdDtmb250LXNpemU6MTNweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6OHB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tcGFwZXIpfQouYXNrIGJ1dHRvbiwuYnRue2ZvbnQtZmFtaWx5OmluaGVyaXQ7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi4wNWVtO2NvbG9yOiMxYTEyMDg7YmFja2dyb3VuZDp2YXIoLS1nb2xkKTtib3JkZXI6MDtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjlweCAxNHB4O2N1cnNvcjpwb2ludGVyfQouYnRuLmdob3N0e2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLWluayk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKX0KI2Fza0Fuc3ttYXJnaW4tdG9wOjEwcHg7Zm9udC1zaXplOjEzcHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Y29sb3I6dmFyKC0taW5rKX0KLmZvb3R7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjlweDtsZXR0ZXItc3BhY2luZzouMjJlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7Y29sb3I6dmFyKC0tbXV0ZWQpO21hcmdpbi10b3A6MzBweH0KLm11dGVke2NvbG9yOnZhcigtLW11dGVkKX0uaGlkZXtkaXNwbGF5Om5vbmV9Cjwvc3R5bGU+CjwvaGVhZD4KPGJvZHk+CjxkaXYgY2xhc3M9IndyYXAiPgogIDxoZWFkZXI+CiAgICA8ZGl2IGNsYXNzPSJicmFuZCI+CiAgICAgIDxkaXYgY2xhc3M9InciPlNJQ09SQTwvZGl2PjxkaXYgY2xhc3M9InJ1bGUiPjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJzdWIiPkNPTlNVTFRJTkcgJm1pZGRvdDsgUEVSRk9STUFOQ0UgREFTSEJPQVJEPC9kaXY+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImhtZXRhIj4KICAgICAgPGRpdiBjbGFzcz0ibGl2ZSI+PHNwYW4gY2xhc3M9ImRvdCI+PC9zcGFuPjxzcGFuIGlkPSJsaXZlTGFiZWwiPkxpdmUgZGF0YTwvc3Bhbj48L2Rpdj4KICAgICAgPGRpdiBpZD0iZ2VuQXQiPjwvZGl2PgogICAgICA8ZGl2PkFzdG9yaWEgQWR2ZXJ0aXNpbmcgQ29tcGFueTwvZGl2PgogICAgPC9kaXY+CiAgPC9oZWFkZXI+CgogIDxkaXYgY2xhc3M9ImNvbnRyb2xzIj4KICAgIDxkaXYgY2xhc3M9ImZsZCI+PGxhYmVsIGZvcj0iZl90ZiI+VGltZSBGcmFtZTwvbGFiZWw+CiAgICAgIDxzZWxlY3QgaWQ9ImZfdGYiPgogICAgICAgIDxvcHRpb24gdmFsdWU9InRoaXMiPlRoaXMgTW9udGg8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSJsYXN0Ij5MYXN0IE1vbnRoPC9vcHRpb24+CiAgICAgICAgPG9wdGlvbiB2YWx1ZT0iM20iIHNlbGVjdGVkPkxhc3QgMyBNb250aHM8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSI2bSI+TGFzdCA2IE1vbnRoczwvb3B0aW9uPgogICAgICAgIDxvcHRpb24gdmFsdWU9IjEybSI+TGFzdCAxMiBNb250aHM8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSJ5dGQiPlllYXIgdG8gRGF0ZTwvb3B0aW9uPgogICAgICAgIDxvcHRpb24gdmFsdWU9ImN1c3RvbSI+Q3VzdG9tIFJhbmdl4oCmPC9vcHRpb24+CiAgICAgIDwvc2VsZWN0PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJmbGQgcmFuZ2UiIGlkPSJjdXN0b21XcmFwIiBzdHlsZT0iZGlzcGxheTpub25lIj4KICAgICAgPGlucHV0IHR5cGU9Im1vbnRoIiBpZD0iZl9mcm9tIj48c3BhbiBjbGFzcz0ibXV0ZWQiIHN0eWxlPSJmb250LXNpemU6MTFweCI+dG88L3NwYW4+PGlucHV0IHR5cGU9Im1vbnRoIiBpZD0iZl90byI+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImZsZCI+PGxhYmVsIGZvcj0iZl9jbXAiPkNvbXBhcmU8L2xhYmVsPgogICAgICA8c2VsZWN0IGlkPSJmX2NtcCI+CiAgICAgICAgPG9wdGlvbiB2YWx1ZT0icGVyaW9kIiBzZWxlY3RlZD5QcmV2aW91cyBQZXJpb2Q8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSJ5ZWFyIj5QcmV2aW91cyBZZWFyPC9vcHRpb24+CiAgICAgIDwvc2VsZWN0PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJmbGQiPjxsYWJlbCBmb3I9ImZfbWV0cmljIj5NZXRyaWM8L2xhYmVsPgogICAgICA8c2VsZWN0IGlkPSJmX21ldHJpYyI+CiAgICAgICAgPG9wdGlvbiB2YWx1ZT0iMCIgc2VsZWN0ZWQ+U2Vzc2lvbnM8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSIxIj5Ub3RhbCBVc2Vyczwvb3B0aW9uPgogICAgICAgIDxvcHRpb24gdmFsdWU9IjIiPlZpZXdzPC9vcHRpb24+CiAgICAgICAgPG9wdGlvbiB2YWx1ZT0iMyI+RXZlbnRzIChFdmVudCBDb3VudCk8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSI0Ij5LZXkgRXZlbnRzPC9vcHRpb24+CiAgICAgIDwvc2VsZWN0PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJmbGQiPjxsYWJlbCBmb3I9ImZfY2giPkNoYW5uZWw8L2xhYmVsPjxzZWxlY3QgaWQ9ImZfY2giPjwvc2VsZWN0PjwvZGl2PgogICAgPGRpdiBjbGFzcz0iZmxkIj48bGFiZWwgZm9yPSJmX3JlZyI+UmVnaW9uPC9sYWJlbD48c2VsZWN0IGlkPSJmX3JlZyI+PC9zZWxlY3Q+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJmbGQiPjxsYWJlbCBmb3I9ImZfY2l0eSI+Q2l0eTwvbGFiZWw+PHNlbGVjdCBpZD0iZl9jaXR5Ij48L3NlbGVjdD48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImZsZCI+PGxhYmVsIGZvcj0iZl9rZSI+S2V5IEV2ZW50PC9sYWJlbD48c2VsZWN0IGlkPSJmX2tlIj48L3NlbGVjdD48L2Rpdj4KICAgIDxidXR0b24gY2xhc3M9ImJ0biBnaG9zdCIgaWQ9ImFuQnRuIiBzdHlsZT0ibWFyZ2luLWxlZnQ6YXV0byI+UmVnZW5lcmF0ZSBhbmFseXNpczwvYnV0dG9uPgogIDwvZGl2PgoKICA8ZGl2IGNsYXNzPSJrcGlzIiBpZD0ia3BpcyI+PC9kaXY+CgogIDxzZWN0aW9uIGNsYXNzPSJleGVjIj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+RXhlY3V0aXZlIFN1bW1hcnk8L2gyPjxzcGFuIGNsYXNzPSJzZWMtc3ViIiBpZD0id2luTGFiZWwiPjwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgaWQ9ImV4ZWNTdW0iIGRhdGEtZW1wdHk9IjEiPkFuYWx5c2lzIHJ1bnMgb24gdGhlIGxpdmUgZGFzaGJvYXJkLjwvZGl2PgogICAgPGRpdiBjbGFzcz0iYWN0aW9ucyI+PGgzPlByaW9yaXR5IEFjdGlvbnM8L2gzPjxkaXYgaWQ9ImFjdGlvbkxpc3QiIGRhdGEtZW1wdHk9IjEiIGNsYXNzPSJtdXRlZCI+Tm8gYWN0aW9uIGl0ZW1zIGZvciB0aGlzIHZpZXcuPC9kaXY+PC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8IS0tIEdBNCAtLT4KICA8c2VjdGlvbj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+V2Vic2l0ZSBUcmFmZmljICZtaWRkb3Q7IEdBNDwvaDI+PHNwYW4gY2xhc3M9InNlYy1zdWIiPk1ldHJpYyB0cmVuZCBhbmQgY2hhbm5lbCBtaXggJm1pZGRvdDsgZmlsdGVyZWQgYWJvdmU8L3NwYW4+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJnYTRjdHgiIGlkPSJnYTRDdHgiPjwvZGl2PgogICAgPGRpdiBjbGFzcz0iZ3JpZDIiPgogICAgICA8ZGl2IGNsYXNzPSJjaGFydGJveCI+PGNhbnZhcyBpZD0iZ2E0VHJlbmQiPjwvY2FudmFzPjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJjaGFydGJveCI+PGNhbnZhcyBpZD0iZ2E0Q2hhbm5lbHMiPjwvY2FudmFzPjwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGlkPSJhbl9nYTQiIGNsYXNzPSJhbm90ZSI+PGRpdiBjbGFzcz0iYW5vdGUtaCI+R0E0IEFuYWx5c3QgTm90ZTwvZGl2PjxkaXYgY2xhc3M9ImFub3RlLWIiIGRhdGEtZW1wdHk9IjEiPuKAlDwvZGl2PjwvZGl2PgogIDwvc2VjdGlvbj4KCiAgPCEtLSBHb29nbGUgQWRzIC0tPgogIDxzZWN0aW9uPgogICAgPGRpdiBjbGFzcz0ic2VjLWgiPjxoMj5Hb29nbGUgQWRzPC9oMj48c3BhbiBjbGFzcz0ic2VjLXN1YiI+U3BlbmQsIGNvbnZlcnNpb25zIGFuZCBjYW1wYWlnbnM8L3NwYW4+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJncmlkMiI+CiAgICAgIDxkaXYgY2xhc3M9ImNoYXJ0Ym94Ij48Y2FudmFzIGlkPSJnYWRzVHJlbmQiPjwvY2FudmFzPjwvZGl2PgogICAgICA8ZGl2Pjx0YWJsZSBpZD0iZ2Fkc0NhbXBzIj48L3RhYmxlPjwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGlkPSJhbl9nYWRzIiBjbGFzcz0iYW5vdGUiPjxkaXYgY2xhc3M9ImFub3RlLWgiPkdvb2dsZSBBZHMgQW5hbHlzdCBOb3RlPC9kaXY+PGRpdiBjbGFzcz0iYW5vdGUtYiIgZGF0YS1lbXB0eT0iMSI+4oCUPC9kaXY+PC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8IS0tIFNlYXJjaCBDb25zb2xlIC0tPgogIDxzZWN0aW9uPgogICAgPGRpdiBjbGFzcz0ic2VjLWgiPjxoMj5TZWFyY2ggQ29uc29sZSAmbWlkZG90OyBTRU88L2gyPjxzcGFuIGNsYXNzPSJzZWMtc3ViIj5DbGlja3MsIGltcHJlc3Npb25zLCBwb3NpdGlvbiAmYW1wOyB0b3AgcXVlcmllczwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImdyaWQyIj4KICAgICAgPGRpdiBjbGFzcz0iY2hhcnRib3giPjxjYW52YXMgaWQ9ImdzY1RyZW5kIj48L2NhbnZhcz48L2Rpdj4KICAgICAgPGRpdj48dGFibGUgaWQ9ImdzY1F1ZXJpZXMiPjwvdGFibGU+PC9kaXY+CiAgICA8L2Rpdj4KICAgIDxkaXYgaWQ9ImFuX2dzYyIgY2xhc3M9ImFub3RlIj48ZGl2IGNsYXNzPSJhbm90ZS1oIj5TZWFyY2ggQ29uc29sZSBBbmFseXN0IE5vdGU8L2Rpdj48ZGl2IGNsYXNzPSJhbm90ZS1iIiBkYXRhLWVtcHR5PSIxIj7igJQ8L2Rpdj48L2Rpdj4KICA8L3NlY3Rpb24+CgogIDwhLS0gR0hMOiBGb3JtcyAmIFNvdXJjZXMgLS0+CiAgPHNlY3Rpb24+CiAgICA8ZGl2IGNsYXNzPSJzZWMtaCI+PGgyPkZvcm0gU3VibWlzc2lvbnMgJm1pZGRvdDsgR29IaWdoTGV2ZWw8L2gyPjxzcGFuIGNsYXNzPSJzZWMtc3ViIj5GaWx0ZXIgYnkgZm9ybSDigJQgc2VsZWN0IG9uZSBvciBtYW55PC9zcGFuPjwvZGl2PgogICAgPGRpdiBjbGFzcz0iZm9ybXMtZmlsdGVyIiBpZD0iZm9ybUZpbHRlciI+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJncmlkMiBldmVuIj4KICAgICAgPGRpdiBjbGFzcz0iY2hhcnRib3giPjxjYW52YXMgaWQ9ImdobEZvcm1zIj48L2NhbnZhcz48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2hhcnRib3giPjxjYW52YXMgaWQ9ImdobFNvdXJjZXMiPjwvY2FudmFzPjwvZGl2PgogICAgPC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8IS0tIEdITDogSm91cm5leSAtLT4KICA8c2VjdGlvbj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+Rm9ybS1GaWxsZXIgSm91cm5leTwvaDI+PHNwYW4gY2xhc3M9InNlYy1zdWIiIGlkPSJqcm5TY29wZSI+QWxsIGZvcm1zPC9zcGFuPjwvZGl2PgogICAgPGRpdiBjbGFzcz0ianJvdyIgaWQ9ImpvdXJuZXlDYXJkcyI+PC9kaXY+CiAgICA8ZGl2IGlkPSJlbWFpbEJsb2NrIiBjbGFzcz0iYW5vdGUgaGlkZSI+PGRpdiBjbGFzcz0iYW5vdGUtaCI+RW1haWwgRW5nYWdlbWVudDwvZGl2PjxkaXYgY2xhc3M9ImFub3RlLWIiIGlkPSJlbWFpbEJvZHkiPjwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibXV0ZWQiIGlkPSJqb3VybmV5Tm90ZSIgc3R5bGU9ImZvbnQtc2l6ZToxMXB4O21hcmdpbi10b3A6MTBweCI+PC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8IS0tIEdITDogUGlwZWxpbmVzIC0tPgogIDxzZWN0aW9uPgogICAgPGRpdiBjbGFzcz0ic2VjLWgiPjxoMj5QaXBlbGluZSBWaXNpYmlsaXR5PC9oMj48c3BhbiBjbGFzcz0ic2VjLXN1YiI+T3BlbiBvcHBvcnR1bml0aWVzIGJ5IHBpcGVsaW5lICZhbXA7IHN0YWdlPC9zcGFuPjwvZGl2PgogICAgPGRpdiBjbGFzcz0icGlwZXMiIGlkPSJwaXBlcyI+PC9kaXY+CiAgICA8ZGl2IGlkPSJhbl9naGwiIGNsYXNzPSJhbm90ZSI+PGRpdiBjbGFzcz0iYW5vdGUtaCI+R29IaWdoTGV2ZWwgQW5hbHlzdCBOb3RlPC9kaXY+PGRpdiBjbGFzcz0iYW5vdGUtYiIgZGF0YS1lbXB0eT0iMSI+4oCUPC9kaXY+PC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8IS0tIFEmQSAtLT4KICA8c2VjdGlvbj4KICAgIDxkaXYgY2xhc3M9InNlYy1oIj48aDI+QXNrIHRoZSBkYXRhPC9oMj48c3BhbiBjbGFzcz0ic2VjLXN1YiI+UXVlc3Rpb25zIGFuc3dlcmVkIGZyb20gdGhpcyByZXBvcnQgb25seTwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImFzayI+PGlucHV0IGlkPSJhc2tRIiBwbGFjZWhvbGRlcj0iZS5nLiBXaGljaCBmb3JtIGRyaXZlcyB0aGUgbW9zdCB3b24gcmV2ZW51ZT8iPjxidXR0b24gaWQ9ImFza0dvIj5Bc2s8L2J1dHRvbj48L2Rpdj4KICAgIDxkaXYgaWQ9ImFza0FucyI+PC9kaXY+CiAgPC9zZWN0aW9uPgoKICA8ZGl2IGNsYXNzPSJmb290Ij5TaWNvcmEgQ29uc3VsdGluZyAmbWlkZG90OyBCdWlsdCBieSBBc3RvcmlhIEFkdmVydGlzaW5nIENvbXBhbnkgJm1pZGRvdDsgPHNwYW4gaWQ9ImJ1aWxkTm8iPjwvc3Bhbj48L2Rpdj4KPC9kaXY+Cgo8c2NyaXB0PgoidXNlIHN0cmljdCI7Ci8qX19EQVRBX18qLwp2YXIgREFUQSA9IHdpbmRvdy5fX0RBU0hfREFUQV9fIHx8IHt9Owp2YXIgSEFTQ0hBUlQgPSAodHlwZW9mIENoYXJ0ICE9PSAndW5kZWZpbmVkJyk7CnZhciBjaGFydHMgPSB7fTsKdmFyIHNlbGVjdGVkRm9ybXMgPSBudWxsOyAvLyBudWxsID0gYWxsCnZhciBmaWx0ZXJzUmVhZHkgPSBmYWxzZTsKCi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tCmZ1bmN0aW9uICQoaWQpe3JldHVybiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7fQpmdW5jdGlvbiBmbXQobil7bj0rbnx8MDtyZXR1cm4gbj49MTAwMD9uLnRvTG9jYWxlU3RyaW5nKCdlbi1VUycse21heGltdW1GcmFjdGlvbkRpZ2l0czowfSk6KE1hdGgucm91bmQobioxMCkvMTArJycpLnJlcGxhY2UoL1wuMCQvLCcnKTt9CmZ1bmN0aW9uIG1vbmV5KG4pe3JldHVybiAnJCcrIChNYXRoLnJvdW5kKCtufHwwKSkudG9Mb2NhbGVTdHJpbmcoJ2VuLVVTJyk7fQpmdW5jdGlvbiBwY3QoYSxiKXtpZighYilyZXR1cm4gbnVsbDtyZXR1cm4gKGEtYikvYioxMDA7fQpmdW5jdGlvbiBjaGdIdG1sKGN1cixwcmV2KXt2YXIgcD1wY3QoY3VyLHByZXYpO2lmKHA9PT1udWxsKXJldHVybiAnPHNwYW4gY2xhc3M9ImNoZyBtdXRlZCI+4oCUPC9zcGFuPic7dmFyIHVwPXA+PTA7cmV0dXJuICc8c3BhbiBjbGFzcz0iY2hnICcrKHVwPyd1cCc6J2Rvd24nKSsnIj4nKyh1cD8n4payJzon4pa8JykrJyAnK01hdGguYWJzKHApLnRvRml4ZWQoMSkrJyUgdnMgcHJldjwvc3Bhbj4nO30KZnVuY3Rpb24gbUxhYmVsKHltKXtpZigheW0pcmV0dXJuICcnO3ZhciB5PXltLnNsaWNlKDAsNCksbT0reW0uc2xpY2UoNCw2KTtyZXR1cm4gWydKYW4nLCdGZWInLCdNYXInLCdBcHInLCdNYXknLCdKdW4nLCdKdWwnLCdBdWcnLCdTZXAnLCdPY3QnLCdOb3YnLCdEZWMnXVttLTFdKyIgJyIreS5zbGljZSgyKTt9CmZ1bmN0aW9uIGFsbE1vbnRocygpe3JldHVybiAoREFUQS5tb250aHN8fFtdKS5zbGljZSgpLnNvcnQoKTt9CmZ1bmN0aW9uIHltQWRkKHltLGQpe3ZhciB5PStTdHJpbmcoeW0pLnNsaWNlKDAsNCksbT0rU3RyaW5nKHltKS5zbGljZSg0KS0xLHQ9eSoxMittK2Q7cmV0dXJuIFN0cmluZyhNYXRoLmZsb29yKHQvMTIpKS5wYWRTdGFydCg0LCcwJykrU3RyaW5nKCh0JTEyKSsxKS5wYWRTdGFydCgyLCcwJyk7fQpmdW5jdGlvbiByYW5nZUVuZChlbmQsbil7dmFyIGE9W107Zm9yKHZhciBpPW4tMTtpPj0wO2ktLSlhLnB1c2goeW1BZGQoZW5kLC1pKSk7cmV0dXJuIGE7fQpmdW5jdGlvbiBhbmNob3JZTSgpe3JldHVybiBEQVRBLmN1cnJlbnR8fGFsbE1vbnRocygpLnNsaWNlKC0xKVswXXx8bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsNykucmVwbGFjZSgnLScsJycpO30KLy8gQWxsIHNlY3Rpb25zIHJlbmRlciBvZmYgd2luZG93TW9udGhzKCk7IG1vbnRocyB3aXRoIG5vIGRhdGEgc3VtIHRvIDAgZG93bnN0cmVhbSwgc28gY29tcHV0ZWQgd2luZG93cyBhcmUgc2FmZS4KZnVuY3Rpb24gd2luZG93TW9udGhzKCl7CiAgdmFyIHRmPSQoJ2ZfdGYnKS52YWx1ZSwgQT1hbmNob3JZTSgpOwogIGlmKHRmPT09J3RoaXMnKXJldHVybiBbeW1BZGQoQSwxKV07CiAgaWYodGY9PT0nbGFzdCcpcmV0dXJuIFtBXTsKICBpZih0Zj09PSczbScpcmV0dXJuIHJhbmdlRW5kKEEsMyk7CiAgaWYodGY9PT0nNm0nKXJldHVybiByYW5nZUVuZChBLDYpOwogIGlmKHRmPT09JzEybScpcmV0dXJuIHJhbmdlRW5kKEEsMTIpOwogIGlmKHRmPT09J3l0ZCcpe3ZhciB5PUEuc2xpY2UoMCw0KSxtbT0rQS5zbGljZSg0KSxhPVtdO2Zvcih2YXIgbT0xO208PW1tO20rKylhLnB1c2goeStTdHJpbmcobSkucGFkU3RhcnQoMiwnMCcpKTtyZXR1cm4gYTt9CiAgaWYodGY9PT0nY3VzdG9tJyl7CiAgICB2YXIgZj0kKCdmX2Zyb20nKSYmJCgnZl9mcm9tJykudmFsdWUsdD0kKCdmX3RvJykmJiQoJ2ZfdG8nKS52YWx1ZTsKICAgIGlmKCFmfHwhdClyZXR1cm4gW0FdOwogICAgdmFyIGZyPWYucmVwbGFjZSgnLScsJycpLHRvPXQucmVwbGFjZSgnLScsJycpO2lmKGZyPnRvKXt2YXIgej1mcjtmcj10bzt0bz16O30KICAgIHZhciBhPVtdLGN1cj1mcjtmb3IodmFyIGk9MDtpPDYwJiZjdXI8PXRvO2krKyl7YS5wdXNoKGN1cik7Y3VyPXltQWRkKGN1ciwxKTt9CiAgICByZXR1cm4gYS5sZW5ndGg/YTpbQV07CiAgfQogIHJldHVybiByYW5nZUVuZChBLDMpOwp9CmZ1bmN0aW9uIHByZXZNb250aHMod2luKXsKICBpZighd2luLmxlbmd0aClyZXR1cm4gW107CiAgaWYoJCgnZl9jbXAnKS52YWx1ZT09PSd5ZWFyJylyZXR1cm4gd2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4geW1BZGQobSwtMTIpO30pOwogIHZhciBzdGFydD13aW5bMF0sYT1bXTtmb3IodmFyIGk9d2luLmxlbmd0aDtpPj0xO2ktLSlhLnB1c2goeW1BZGQoc3RhcnQsLWkpKTtyZXR1cm4gYTsgLy8gcHJldmlvdXMgcGVyaW9kCn0KLy8gLS0tLS0tLS0tLSBtZXRyaWMgLyBjaGFubmVsIC8ga2V5LWV2ZW50IGhlbHBlcnMgLS0tLS0tLS0tLQp2YXIgTUVUUklDUz1bWydTZXNzaW9ucycsMF0sWydUb3RhbCBVc2VycycsMV0sWydWaWV3cycsMl0sWydFdmVudHMgKEV2ZW50IENvdW50KScsM10sWydLZXkgRXZlbnRzJyw0XV07CmZ1bmN0aW9uIGN1ck1ldHJpYygpe3JldHVybiArKCgkKCdmX21ldHJpYycpfHx7fSkudmFsdWUpfHwwO30KZnVuY3Rpb24gY3VyQ2hhbm5lbCgpe3JldHVybiAoJCgnZl9jaCcpJiYkKCdmX2NoJykudmFsdWUpfHwnQWxsJzt9CmZ1bmN0aW9uIGtlTmFtZXMoKXtyZXR1cm4gKERBVEEua2VOYW1lc3x8W10pLm1hcChwcmV0dHlLRSk7fQpmdW5jdGlvbiBwcmV0dHlLRShzKXtyZXR1cm4gU3RyaW5nKHN8fCcnKS5yZXBsYWNlKC9fL2csJyAnKS5yZXBsYWNlKC9cYihnaGx8cHBjfHNlb3xjcm0pXGIvZ2ksZnVuY3Rpb24obSl7cmV0dXJuIG0udG9VcHBlckNhc2UoKTt9KS5yZXBsYWNlKC9cYlthLXpdL2csZnVuY3Rpb24oYyl7cmV0dXJuIGMudG9VcHBlckNhc2UoKTt9KTt9CmZ1bmN0aW9uIHN1bUNoKHdpbixpZHgsY2hmKXt2YXIgdD0wO3dpbi5mb3JFYWNoKGZ1bmN0aW9uKHltKXsKICBpZihjaGY9PT0nQWxsJyl7dmFyIHR0PURBVEEudG90YWxzJiZEQVRBLnRvdGFsc1t5bV07aWYodHQpe3QrPSgrdHRbaWR4XXx8MCk7cmV0dXJuO319CiAgdmFyIGQ9REFUQS5jaG0mJkRBVEEuY2htW3ltXTtpZighZClyZXR1cm47CiAgaWYoY2hmPT09J0FsbCcpe09iamVjdC5rZXlzKGQpLmZvckVhY2goZnVuY3Rpb24oYyl7dCs9KCtkW2NdW2lkeF18fDApO30pO30KICBlbHNlIGlmKGRbY2hmXSl7dCs9KCtkW2NoZl1baWR4XXx8MCk7fQp9KTtyZXR1cm4gdDt9CmZ1bmN0aW9uIHN1bUtFKHdpbixpZHgpe3ZhciB0PTA7d2luLmZvckVhY2goZnVuY3Rpb24oeW0pe3ZhciBhPURBVEEua2UmJkRBVEEua2VbeW1dO2lmKGEmJmFbaWR4XSE9bnVsbCl0Kz0oK2FbaWR4XXx8MCk7fSk7cmV0dXJuIHQ7fQpmdW5jdGlvbiBzdW1HZW8obWFwLHdpbixuYW1lKXt2YXIgcz0wLGs9MDt3aW4uZm9yRWFjaChmdW5jdGlvbih5bSl7dmFyIGQ9bWFwJiZtYXBbeW1dO2lmKCFkKXJldHVybjtpZihuYW1lPT09J0FsbCcpe09iamVjdC5rZXlzKGQpLmZvckVhY2goZnVuY3Rpb24obil7cys9K2Rbbl1bMF18fDA7ays9K2Rbbl1bMV18fDA7fSk7fWVsc2UgaWYoZFtuYW1lXSl7cys9K2RbbmFtZV1bMF18fDA7ays9K2RbbmFtZV1bMV18fDA7fX0pO3JldHVybiBbcyxrXTt9CmZ1bmN0aW9uIGdlb0RlbHRhKGN1cixwcmV2KXt2YXIgcD1wY3QoY3VyLHByZXYpO2lmKHA9PT1udWxsKXJldHVybiBjdXI+MD8nbmV3Jzon4oCUJztyZXR1cm4gKHA+PTA/J+KWsiAnOifilrwgJykrTWF0aC5hYnMocCkudG9GaXhlZCgwKSsnJSc7fQoKdmFyIFBBTEVUVEU9WycjZjU4NDU5JywnIzQwNWJhNCcsJyM2ZTgyOTgnLCcjOGE5YjdlJywnI2I1ODM1ZicsJyM5YTdlOGQnLCcjODg5MzliJywnI2QzYzA4ZicsJyM2ZjYyODAnXTsKZnVuY3Rpb24gbWtDaGFydChpZCxjZmcpe2lmKCFIQVNDSEFSVClyZXR1cm47aWYoY2hhcnRzW2lkXSl7Y2hhcnRzW2lkXS5kZXN0cm95KCk7fXZhciBlbD0kKGlkKTtpZighZWwpcmV0dXJuO2NoYXJ0c1tpZF09bmV3IENoYXJ0KGVsLmdldENvbnRleHQoJzJkJyksY2ZnKTt9CmZ1bmN0aW9uIGxpbmVDZmcobGFiZWxzLGRhdGFzZXRzKXtyZXR1cm4ge3R5cGU6J2xpbmUnLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6ZGF0YXNldHN9LG9wdGlvbnM6YmFzZU9wdHModHJ1ZSl9O30KZnVuY3Rpb24gYmFzZU9wdHMobGVnZW5kKXtyZXR1cm4ge3Jlc3BvbnNpdmU6dHJ1ZSxtYWludGFpbkFzcGVjdFJhdGlvOmZhbHNlLHBsdWdpbnM6e2xlZ2VuZDp7ZGlzcGxheTohIWxlZ2VuZCxwb3NpdGlvbjonYm90dG9tJyxsYWJlbHM6e2JveFdpZHRoOjEwLGZvbnQ6e3NpemU6MTB9fX19LHNjYWxlczp7eDp7Z3JpZDp7ZGlzcGxheTpmYWxzZX0sdGlja3M6e2ZvbnQ6e3NpemU6MTB9fX0seTp7YmVnaW5BdFplcm86dHJ1ZSx0aWNrczp7Zm9udDp7c2l6ZToxMH19fX19O30KCi8vIC0tLS0tLS0tLS0gR0E0IC0tLS0tLS0tLS0KZnVuY3Rpb24gZ2E0TW9udGhUb3RhbCh5bSl7dmFyIHQ9KERBVEEudG90YWxzJiZEQVRBLnRvdGFsc1t5bV0pfHxudWxsO2lmKHQpcmV0dXJuIHQ7dmFyIGNobT0oREFUQS5jaG0mJkRBVEEuY2htW3ltXSl8fHt9O3ZhciBzPVswLDAsMCwwLDBdO09iamVjdC5rZXlzKGNobSkuZm9yRWFjaChmdW5jdGlvbihjKXtjaG1bY10uZm9yRWFjaChmdW5jdGlvbih2LGkpe3NbaV0rPSt2fHwwO30pO30pO3JldHVybiBzO30KZnVuY3Rpb24gc3VtTWV0cmljKHdpbixpZHgpe3JldHVybiB3aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7cmV0dXJuIGErKGdhNE1vbnRoVG90YWwobSlbaWR4XXx8MCk7fSwwKTt9CmZ1bmN0aW9uIHJlbmRlckdBNCgpewogIHZhciB3aW49d2luZG93TW9udGhzKCkuZmlsdGVyKGZ1bmN0aW9uKG0pe3JldHVybiBhbGxNb250aHMoKS5pbmRleE9mKG0pPj0wO30pOwogIGlmKCF3aW4ubGVuZ3RoKXdpbj1hbGxNb250aHMoKS5zbGljZSgtMSk7CiAgdmFyIHByZXY9cHJldk1vbnRocyh3aW4pOwogIHZhciBtSWR4PWN1ck1ldHJpYygpLGNoZj1jdXJDaGFubmVsKCk7CiAgdmFyIGtlZj0kKCdmX2tlJyk/JCgnZl9rZScpLnZhbHVlOidhbGwnLGtlU2VsPWtlZj09PSdhbGwnP251bGw6K2tlZjsKICB2YXIgaXNLRT0obUlkeD09PTQmJmtlU2VsIT09bnVsbCk7CiAgdmFyIG1OYW1lPWlzS0U/a2VOYW1lcygpW2tlU2VsXTpNRVRSSUNTW21JZHhdWzBdOwogIC8vIHRyZW5kOiBzZWxlY3RlZCBtZXRyaWMgKG9yIHNwZWNpZmljIGtleSBldmVudCkgZm9yIHRoZSB3aW5kb3csIHdpdGggdGhlIGNvbXBhcmlzb24gc2VyaWVzCiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGN1cj13aW4ubWFwKGZ1bmN0aW9uKG0pe3JldHVybiBpc0tFP3N1bUtFKFttXSxrZVNlbCk6c3VtQ2goW21dLG1JZHgsY2hmKTt9KTsKICB2YXIgZHM9W3tsYWJlbDptTmFtZSsoIWlzS0UmJmNoZiE9PSdBbGwnPycgwrcgJytjaGY6JycpLGRhdGE6Y3VyLGJvcmRlckNvbG9yOlBBTEVUVEVbMF0sYmFja2dyb3VuZENvbG9yOidyZ2JhKDI0NSwxMzIsODksLjEyKScsZmlsbDp0cnVlLHRlbnNpb246LjN9XTsKICBpZihwcmV2Lmxlbmd0aCl7CiAgICB2YXIgY21wUz13aW4ubWFwKGZ1bmN0aW9uKG0saSl7dmFyIHBtPXByZXZbaV07cmV0dXJuIGlzS0U/c3VtS0UoW3BtXSxrZVNlbCk6c3VtQ2goW3BtXSxtSWR4LGNoZik7fSk7CiAgICBpZihjbXBTLnNvbWUoZnVuY3Rpb24odil7cmV0dXJuIHY+MDt9KSlkcy5wdXNoKHtsYWJlbDooJCgnZl9jbXAnKS52YWx1ZT09PSd5ZWFyJz8nUHJldiB5ZWFyJzonUHJldiBwZXJpb2QnKSxkYXRhOmNtcFMsYm9yZGVyQ29sb3I6JyNjNGM4Y2QnLGJvcmRlcldpZHRoOjEuNSxib3JkZXJEYXNoOls0LDNdLGJhY2tncm91bmRDb2xvcjondHJhbnNwYXJlbnQnLHRlbnNpb246LjMscG9pbnRSYWRpdXM6MH0pOwogIH0KICBta0NoYXJ0KCdnYTRUcmVuZCcse3R5cGU6J2xpbmUnLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6ZHN9LG9wdGlvbnM6YmFzZU9wdHModHJ1ZSl9KTsKICAvLyBjaGFubmVsIG1peCBmb3IgdGhlIHNlbGVjdGVkIG1ldHJpYywgbGFzdCBtb250aCBpbiB3aW5kb3cKICB2YXIgbGFzdD13aW5bd2luLmxlbmd0aC0xXTt2YXIgY2htPShEQVRBLmNobSYmREFUQS5jaG1bbGFzdF0pfHx7fTsKICB2YXIgZE1ldHJpYz1pc0tFPzA6bUlkeDsgLy8ga2V5LWV2ZW50IHZpZXcgZmFsbHMgYmFjayB0byBzZXNzaW9ucyBtaXggKG5vIHBlci1jaGFubmVsIGtleS1ldmVudCBzcGxpdCkKICB2YXIgZW50cmllcz1PYmplY3Qua2V5cyhjaG0pLm1hcChmdW5jdGlvbihjKXtyZXR1cm4gW2MsK2NobVtjXVtkTWV0cmljXXx8MF07fSkuZmlsdGVyKGZ1bmN0aW9uKGUpe3JldHVybiBlWzFdPjA7fSkuc29ydChmdW5jdGlvbihhLGIpe3JldHVybiBiWzFdLWFbMV07fSk7CiAgbWtDaGFydCgnZ2E0Q2hhbm5lbHMnLHt0eXBlOidkb3VnaG51dCcsZGF0YTp7bGFiZWxzOmVudHJpZXMubWFwKGZ1bmN0aW9uKGUpe3JldHVybiBlWzBdO30pLGRhdGFzZXRzOlt7ZGF0YTplbnRyaWVzLm1hcChmdW5jdGlvbihlKXtyZXR1cm4gZVsxXTt9KSwKICAgIGJhY2tncm91bmRDb2xvcjplbnRyaWVzLm1hcChmdW5jdGlvbihlLGkpe3JldHVybiBjaGYhPT0nQWxsJz8oZVswXT09PWNoZj9QQUxFVFRFWzBdOicjZDlkZWU4Jyk6UEFMRVRURVtpJVBBTEVUVEUubGVuZ3RoXTt9KX1dfSwKICAgIG9wdGlvbnM6e3Jlc3BvbnNpdmU6dHJ1ZSxtYWludGFpbkFzcGVjdFJhdGlvOmZhbHNlLHBsdWdpbnM6e2xlZ2VuZDp7cG9zaXRpb246J3JpZ2h0JyxsYWJlbHM6e2JveFdpZHRoOjEwLGZvbnQ6e3NpemU6MTB9fX0sdGl0bGU6e2Rpc3BsYXk6dHJ1ZSx0ZXh0Ok1FVFJJQ1NbZE1ldHJpY11bMF0rJyBieSBjaGFubmVsIOKAlCAnK21MYWJlbChsYXN0KSxmb250OntzaXplOjExfX19fX0pOwogIHJlbmRlckdBNEN0eCh3aW4scHJldixtSWR4LGNoZixrZVNlbCk7Cn0KZnVuY3Rpb24gcmVuZGVyR0E0Q3R4KHdpbixwcmV2LG1JZHgsY2hmLGtlU2VsKXsKICB2YXIgZWw9JCgnZ2E0Q3R4Jyk7aWYoIWVsKXJldHVybjsKICB2YXIgcmVnZj0kKCdmX3JlZycpPyQoJ2ZfcmVnJykudmFsdWU6J0FsbCcsY2l0eWY9JCgnZl9jaXR5Jyk/JCgnZl9jaXR5JykudmFsdWU6J0FsbCc7CiAgdmFyIG1OYW1lPShtSWR4PT09NCYma2VTZWwhPT1udWxsKT9rZU5hbWVzKClba2VTZWxdOk1FVFJJQ1NbbUlkeF1bMF07CiAgdmFyIHBhcnRzPVsnU2hvd2luZyA8Yj4nK2VzYyhtTmFtZSkrJzwvYj4nKyhjaGYhPT0nQWxsJz8nIMK3IGNoYW5uZWwgPGI+Jytlc2MoY2hmKSsnPC9iPic6JycpXTsKICBpZihyZWdmIT09J0FsbCcpe3ZhciBnPXN1bUdlbyhEQVRBLnJlZyx3aW4scmVnZiksZ3A9c3VtR2VvKERBVEEucmVnLHByZXYscmVnZik7cGFydHMucHVzaCgnUmVnaW9uIDxiPicrZXNjKHJlZ2YpKyc8L2I+OiAnK2ZtdChnWzBdKSsnIHNlc3Npb25zICgnK2dlb0RlbHRhKGdbMF0sZ3BbMF0pKycpLCAnK2ZtdChnWzFdKSsnIGtleSBldmVudHMnKTt9CiAgaWYoY2l0eWYhPT0nQWxsJyl7dmFyIGM9c3VtR2VvKERBVEEuY2l0eSx3aW4sY2l0eWYpLGNwPXN1bUdlbyhEQVRBLmNpdHkscHJldixjaXR5Zik7cGFydHMucHVzaCgnQ2l0eSA8Yj4nK2VzYyhjaXR5ZikrJzwvYj46ICcrZm10KGNbMF0pKycgc2Vzc2lvbnMgKCcrZ2VvRGVsdGEoY1swXSxjcFswXSkrJyksICcrZm10KGNbMV0pKycga2V5IGV2ZW50cycpO30KICBlbC5pbm5lckhUTUw9cGFydHMuam9pbignICZuYnNwO8K3Jm5ic3A7ICcpOwp9CgovLyAtLS0tLS0tLS0tIEdvb2dsZSBBZHMgLS0tLS0tLS0tLQpmdW5jdGlvbiBnYWRzTW9udGhBZ2coeW0pe3ZhciBkPShEQVRBLmdhZHMmJkRBVEEuZ2Fkcy5kYXRhJiZEQVRBLmdhZHMuZGF0YVt5bV0pfHx7fTt2YXIgcz1bMCwwLDAsMF07T2JqZWN0LmtleXMoZCkuZm9yRWFjaChmdW5jdGlvbihjKXtkW2NdLmZvckVhY2goZnVuY3Rpb24odixpKXtzW2ldKz0rdnx8MDt9KTt9KTtyZXR1cm4gczt9IC8vIFtjbGlja3MsaW1wcixjb3N0LGNvbnZdCmZ1bmN0aW9uIHJlbmRlckdhZHMoKXsKICB2YXIgd2luPXdpbmRvd01vbnRocygpLmZpbHRlcihmdW5jdGlvbihtKXtyZXR1cm4gREFUQS5nYWRzJiZEQVRBLmdhZHMuZGF0YSYmREFUQS5nYWRzLmRhdGFbbV07fSk7CiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGNvc3Q9d2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4gZ2Fkc01vbnRoQWdnKG0pWzJdO30pOwogIHZhciBjb252PXdpbi5tYXAoZnVuY3Rpb24obSl7cmV0dXJuIGdhZHNNb250aEFnZyhtKVszXTt9KTsKICBta0NoYXJ0KCdnYWRzVHJlbmQnLHt0eXBlOidiYXInLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6WwogICAge3R5cGU6J2JhcicsbGFiZWw6J1NwZW5kICgkKScsZGF0YTpjb3N0LGJhY2tncm91bmRDb2xvcjpQQUxFVFRFWzBdLHlBeGlzSUQ6J3knLG9yZGVyOjJ9LAogICAge3R5cGU6J2xpbmUnLGxhYmVsOidDb252ZXJzaW9ucycsZGF0YTpjb252LGJvcmRlckNvbG9yOlBBTEVUVEVbMV0seUF4aXNJRDoneTEnLHRlbnNpb246LjMsb3JkZXI6MX0KICBdfSxvcHRpb25zOntyZXNwb25zaXZlOnRydWUsbWFpbnRhaW5Bc3BlY3RSYXRpbzpmYWxzZSxwbHVnaW5zOntsZWdlbmQ6e3Bvc2l0aW9uOidib3R0b20nLGxhYmVsczp7Ym94V2lkdGg6MTAsZm9udDp7c2l6ZToxMH19fX0sc2NhbGVzOnt4OntncmlkOntkaXNwbGF5OmZhbHNlfSx0aWNrczp7Zm9udDp7c2l6ZToxMH19fSx5OntiZWdpbkF0WmVybzp0cnVlLHBvc2l0aW9uOidsZWZ0Jyx0aWNrczp7Zm9udDp7c2l6ZToxMH19fSx5MTp7YmVnaW5BdFplcm86dHJ1ZSxwb3NpdGlvbjoncmlnaHQnLGdyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19fX19KTsKICAvLyBjYW1wYWlnbnMgdGFibGUgZm9yIGxhc3QgbW9udGgKICB2YXIgbGFzdD13aW5bd2luLmxlbmd0aC0xXTt2YXIgZD0oREFUQS5nYWRzJiZEQVRBLmdhZHMuZGF0YSYmREFUQS5nYWRzLmRhdGFbbGFzdF0pfHx7fTsKICB2YXIgcm93cz1PYmplY3Qua2V5cyhkKS5tYXAoZnVuY3Rpb24oYyl7dmFyIHY9ZFtjXTtyZXR1cm4ge2M6YyxjbGlja3M6dlswXSxjb3N0OnZbMl0sY29udjp2WzNdfTt9KS5zb3J0KGZ1bmN0aW9uKGEsYil7cmV0dXJuIGIuY29zdC1hLmNvc3Q7fSk7CiAgdmFyIGh0bWw9Jzx0cj48dGg+Q2FtcGFpZ24g4oCUICcrbUxhYmVsKGxhc3QpKyc8L3RoPjx0aCBjbGFzcz0ibnVtIj5DbGlja3M8L3RoPjx0aCBjbGFzcz0ibnVtIj5TcGVuZDwvdGg+PHRoIGNsYXNzPSJudW0iPkNvbnY8L3RoPjx0aCBjbGFzcz0ibnVtIj5DUEE8L3RoPjwvdHI+JzsKICByb3dzLmZvckVhY2goZnVuY3Rpb24ocil7aHRtbCs9Jzx0cj48dGQ+Jytlc2Moci5jKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+JytmbXQoci5jbGlja3MpKyc8L3RkPjx0ZCBjbGFzcz0ibnVtIj4nK21vbmV5KHIuY29zdCkrJzwvdGQ+PHRkIGNsYXNzPSJudW0iPicrZm10KHIuY29udikrJzwvdGQ+PHRkIGNsYXNzPSJudW0iPicrKHIuY29udj9tb25leShyLmNvc3Qvci5jb252KTon4oCUJykrJzwvdGQ+PC90cj4nO30pOwogICQoJ2dhZHNDYW1wcycpLmlubmVySFRNTD1odG1sfHwnPHRyPjx0ZCBjbGFzcz0ibXV0ZWQiPk5vIGNhbXBhaWduIGRhdGEuPC90ZD48L3RyPic7Cn0KCi8vIC0tLS0tLS0tLS0gU2VhcmNoIENvbnNvbGUgLS0tLS0tLS0tLQpmdW5jdGlvbiByZW5kZXJHU0MoKXsKICB2YXIgd2luPXdpbmRvd01vbnRocygpLmZpbHRlcihmdW5jdGlvbihtKXtyZXR1cm4gREFUQS5nc2MmJkRBVEEuZ3NjLmRhdGEmJkRBVEEuZ3NjLmRhdGFbbV07fSk7CiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGNsaWNrcz13aW4ubWFwKGZ1bmN0aW9uKG0pe3JldHVybiBEQVRBLmdzYy5kYXRhW21dWzBdO30pOwogIHZhciBwb3M9d2luLm1hcChmdW5jdGlvbihtKXtyZXR1cm4gREFUQS5nc2MuZGF0YVttXVsyXTt9KTsKICBta0NoYXJ0KCdnc2NUcmVuZCcse3R5cGU6J2JhcicsZGF0YTp7bGFiZWxzOmxhYmVscyxkYXRhc2V0czpbCiAgICB7dHlwZTonYmFyJyxsYWJlbDonQ2xpY2tzJyxkYXRhOmNsaWNrcyxiYWNrZ3JvdW5kQ29sb3I6UEFMRVRURVsyXSx5QXhpc0lEOid5JyxvcmRlcjoyfSwKICAgIHt0eXBlOidsaW5lJyxsYWJlbDonQXZnIHBvc2l0aW9uJyxkYXRhOnBvcyxib3JkZXJDb2xvcjpQQUxFVFRFWzRdLHlBeGlzSUQ6J3kxJyx0ZW5zaW9uOi4zLG9yZGVyOjF9CiAgXX0sb3B0aW9uczp7cmVzcG9uc2l2ZTp0cnVlLG1haW50YWluQXNwZWN0UmF0aW86ZmFsc2UscGx1Z2luczp7bGVnZW5kOntwb3NpdGlvbjonYm90dG9tJyxsYWJlbHM6e2JveFdpZHRoOjEwLGZvbnQ6e3NpemU6MTB9fX19LHNjYWxlczp7eDp7Z3JpZDp7ZGlzcGxheTpmYWxzZX0sdGlja3M6e2ZvbnQ6e3NpemU6MTB9fX0seTp7YmVnaW5BdFplcm86dHJ1ZSxwb3NpdGlvbjonbGVmdCcsdGlja3M6e2ZvbnQ6e3NpemU6MTB9fX0seTE6e3JldmVyc2U6dHJ1ZSxwb3NpdGlvbjoncmlnaHQnLGdyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19fX19KTsKICB2YXIgbGFzdD13aW5bd2luLmxlbmd0aC0xXTt2YXIgcT0oREFUQS5nc2MmJkRBVEEuZ3NjLnF1ZXJpZXMmJkRBVEEuZ3NjLnF1ZXJpZXNbbGFzdF0pfHx7fTsKICB2YXIgcm93cz1PYmplY3Qua2V5cyhxKS5tYXAoZnVuY3Rpb24oayl7cmV0dXJuIHtrOmssYzpxW2tdWzBdLGk6cVtrXVsxXSxwOnFba11bMl19O30pLnNvcnQoZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi5jLWEuYzt9KS5zbGljZSgwLDgpOwogIHZhciBodG1sPSc8dHI+PHRoPlRvcCBxdWVyeSDigJQgJyttTGFiZWwobGFzdCkrJzwvdGg+PHRoIGNsYXNzPSJudW0iPkNsaWNrczwvdGg+PHRoIGNsYXNzPSJudW0iPkltcHI8L3RoPjx0aCBjbGFzcz0ibnVtIj5Qb3M8L3RoPjwvdHI+JzsKICByb3dzLmZvckVhY2goZnVuY3Rpb24ocil7aHRtbCs9Jzx0cj48dGQ+Jytlc2Moci5rKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+JytmbXQoci5jKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+JytmbXQoci5pKSsnPC90ZD48dGQgY2xhc3M9Im51bSI+Jysoci5wP3IucC50b0ZpeGVkKDEpOifigJQnKSsnPC90ZD48L3RyPic7fSk7CiAgJCgnZ3NjUXVlcmllcycpLmlubmVySFRNTD1odG1sfHwnPHRyPjx0ZCBjbGFzcz0ibXV0ZWQiPk5vIHF1ZXJ5IGRhdGEuPC90ZD48L3RyPic7Cn0KCi8vIC0tLS0tLS0tLS0gR0hMIC0tLS0tLS0tLS0KZnVuY3Rpb24gZ2hsRm9ybXMoKXtyZXR1cm4gKERBVEEuZ2hsJiZEQVRBLmdobC5mb3Jtcyl8fFtdO30KZnVuY3Rpb24gYWN0aXZlRm9ybXMoKXtyZXR1cm4gc2VsZWN0ZWRGb3Jtc3x8Z2hsRm9ybXMoKS5tYXAoZnVuY3Rpb24oZil7cmV0dXJuIGYubmFtZTt9KTt9CmZ1bmN0aW9uIHJlbmRlckZvcm1GaWx0ZXIoKXsKICB2YXIgYm94PSQoJ2Zvcm1GaWx0ZXInKTt2YXIgZm9ybXM9Z2hsRm9ybXMoKTsKICBpZighZm9ybXMubGVuZ3RoKXtib3guaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0ibXV0ZWQiPk5vIEdvSGlnaExldmVsIGZvcm0gZGF0YS48L3NwYW4+JztyZXR1cm47fQogIHZhciBzZWw9YWN0aXZlRm9ybXMoKTsKICBib3guaW5uZXJIVE1MPWZvcm1zLm1hcChmdW5jdGlvbihmKXt2YXIgb249c2VsLmluZGV4T2YoZi5uYW1lKT49MDtyZXR1cm4gJzxsYWJlbCBjbGFzcz0iY2hpcCAnKyhvbj8nb24nOicnKSsnIj48aW5wdXQgdHlwZT0iY2hlY2tib3giIGRhdGEtZm9ybT0iJytlc2MoZi5uYW1lKSsnIiAnKyhvbj8nY2hlY2tlZCc6JycpKyc+Jytlc2MoZi5uYW1lKSsnIDxzcGFuIGNsYXNzPSJtdXRlZCI+KCcrZi50b3RhbCsnKTwvc3Bhbj48L2xhYmVsPic7fSkuam9pbignJyk7CiAgQXJyYXkucHJvdG90eXBlLmZvckVhY2guY2FsbChib3gucXVlcnlTZWxlY3RvckFsbCgnaW5wdXQnKSxmdW5jdGlvbihjYil7Y2IuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJyxvbkZvcm1Ub2dnbGUpO30pOwp9CmZ1bmN0aW9uIG9uRm9ybVRvZ2dsZSgpewogIHZhciBib3g9JCgnZm9ybUZpbHRlcicpO3ZhciBvbj1bXTsKICBBcnJheS5wcm90b3R5cGUuZm9yRWFjaC5jYWxsKGJveC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpLGZ1bmN0aW9uKGNiKXtpZihjYi5jaGVja2VkKW9uLnB1c2goY2IuZ2V0QXR0cmlidXRlKCdkYXRhLWZvcm0nKSk7fSk7CiAgc2VsZWN0ZWRGb3Jtcz1vbi5sZW5ndGg/b246bnVsbDsgLy8gbm9uZSBjaGVja2VkID0gdHJlYXQgYXMgYWxsCiAgcmVuZGVyRm9ybUZpbHRlcigpO3JlbmRlckdITEZvcm1zKCk7cmVuZGVySm91cm5leSgpOwp9CmZ1bmN0aW9uIHJlbmRlckdITEZvcm1zKCl7CiAgdmFyIGJ5TW9udGg9KERBVEEuZ2hsJiZEQVRBLmdobC5ieU1vbnRoKXx8e307CiAgdmFyIHdpbj13aW5kb3dNb250aHMoKS5maWx0ZXIoZnVuY3Rpb24obSl7cmV0dXJuIGJ5TW9udGhbbV07fSk7CiAgdmFyIGZvcm1zPWFjdGl2ZUZvcm1zKCk7CiAgdmFyIGxhYmVscz13aW4ubWFwKG1MYWJlbCk7CiAgdmFyIGRzPWZvcm1zLm1hcChmdW5jdGlvbihmLGkpe3JldHVybiB7bGFiZWw6ZixkYXRhOndpbi5tYXAoZnVuY3Rpb24obSl7cmV0dXJuIChieU1vbnRoW21dJiZieU1vbnRoW21dW2ZdKXx8MDt9KSxiYWNrZ3JvdW5kQ29sb3I6UEFMRVRURVtpJVBBTEVUVEUubGVuZ3RoXX07fSk7CiAgbWtDaGFydCgnZ2hsRm9ybXMnLHt0eXBlOidiYXInLGRhdGE6e2xhYmVsczpsYWJlbHMsZGF0YXNldHM6ZHN9LG9wdGlvbnM6e3Jlc3BvbnNpdmU6dHJ1ZSxtYWludGFpbkFzcGVjdFJhdGlvOmZhbHNlLHBsdWdpbnM6e2xlZ2VuZDp7cG9zaXRpb246J2JvdHRvbScsbGFiZWxzOntib3hXaWR0aDoxMCxmb250OntzaXplOjl9fX0sdGl0bGU6e2Rpc3BsYXk6dHJ1ZSx0ZXh0OidGb3JtIHN1Ym1pc3Npb25zIGJ5IG1vbnRoJyxmb250OntzaXplOjExfX19LHNjYWxlczp7eDp7c3RhY2tlZDp0cnVlLGdyaWQ6e2Rpc3BsYXk6ZmFsc2V9LHRpY2tzOntmb250OntzaXplOjEwfX19LHk6e3N0YWNrZWQ6dHJ1ZSxiZWdpbkF0WmVybzp0cnVlLHRpY2tzOntmb250OntzaXplOjEwfX19fX19KTsKICAvLyBzb3VyY2VzOiBhZ2dyZWdhdGUgbWFya2V0aW5nIGNoYW5uZWxzIGFjcm9zcyBzZWxlY3RlZCBmb3JtcwogIHZhciBzcmNBZ2c9e307CiAgZ2hsRm9ybXMoKS5mb3JFYWNoKGZ1bmN0aW9uKGYpe2lmKGZvcm1zLmluZGV4T2YoZi5uYW1lKTwwKXJldHVybjtPYmplY3Qua2V5cyhmLmNoYW5uZWxzfHx7fSkuZm9yRWFjaChmdW5jdGlvbihjaCl7c3JjQWdnW2NoXT0oc3JjQWdnW2NoXXx8MCkrZi5jaGFubmVsc1tjaF07fSk7fSk7CiAgdmFyIGVudHM9T2JqZWN0LmtleXMoc3JjQWdnKS5tYXAoZnVuY3Rpb24oayl7cmV0dXJuIFtrLHNyY0FnZ1trXV07fSkuc29ydChmdW5jdGlvbihhLGIpe3JldHVybiBiWzFdLWFbMV07fSk7CiAgbWtDaGFydCgnZ2hsU291cmNlcycse3R5cGU6J2RvdWdobnV0JyxkYXRhOntsYWJlbHM6ZW50cy5tYXAoZnVuY3Rpb24oZSl7cmV0dXJuIHByZXR0eVNyYyhlWzBdKTt9KSxkYXRhc2V0czpbe2RhdGE6ZW50cy5tYXAoZnVuY3Rpb24oZSl7cmV0dXJuIGVbMV07fSksYmFja2dyb3VuZENvbG9yOlBBTEVUVEV9XX0sb3B0aW9uczp7cmVzcG9uc2l2ZTp0cnVlLG1haW50YWluQXNwZWN0UmF0aW86ZmFsc2UscGx1Z2luczp7bGVnZW5kOntwb3NpdGlvbjoncmlnaHQnLGxhYmVsczp7Ym94V2lkdGg6MTAsZm9udDp7c2l6ZToxMH19fSx0aXRsZTp7ZGlzcGxheTp0cnVlLHRleHQ6J01hcmtldGluZyBzb3VyY2Ugb2YgZmlsbHMnLGZvbnQ6e3NpemU6MTF9fX19fSk7Cn0KZnVuY3Rpb24gcHJldHR5U3JjKHMpe3JldHVybiBTdHJpbmcoc3x8JycpLnJlcGxhY2UoL18vZywnICcpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXGJcdy9nLGZ1bmN0aW9uKGMpe3JldHVybiBjLnRvVXBwZXJDYXNlKCk7fSk7fQpmdW5jdGlvbiByZW5kZXJKb3VybmV5KCl7CiAgdmFyIGZvcm1zPWFjdGl2ZUZvcm1zKCk7CiAgJCgnanJuU2NvcGUnKS50ZXh0Q29udGVudD0oc2VsZWN0ZWRGb3Jtcz9mb3Jtcy5qb2luKCcsICcpOidBbGwgZm9ybXMnKTsKICB2YXIgY29udGFjdHM9KChEQVRBLmdobCYmREFUQS5naGwuY29udGFjdHMpfHxbXSkuZmlsdGVyKGZ1bmN0aW9uKGMpe3JldHVybiBjLmlzRm9ybSYmZm9ybXMuaW5kZXhPZihjLmZvcm0pPj0wO30pOwogIHZhciBuPWNvbnRhY3RzLmxlbmd0aDsKICB2YXIgdHhuPWNvbnRhY3RzLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gYy50eG47fSkubGVuZ3RoOwogIHZhciB2YWw9Y29udGFjdHMucmVkdWNlKGZ1bmN0aW9uKGEsYyl7cmV0dXJuIGErKCtjLnR4blZhbHx8MCk7fSwwKTsKICB2YXIgcmVjPWNvbnRhY3RzLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gYy5yZWN1cnJpbmc7fSkubGVuZ3RoOwogIHZhciBpblBpcGU9Y29udGFjdHMuZmlsdGVyKGZ1bmN0aW9uKGMpe3JldHVybiBjLnBpcGVsaW5lO30pLmxlbmd0aDsKICB2YXIgd29uPWNvbnRhY3RzLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gL3dvbi9pLnRlc3QoYy5vcHBTdGF0dXN8fCcnKTt9KS5sZW5ndGg7CiAgdmFyIGNhcmRzPVsKICAgIFsnQ29udGFjdHMnLGZtdChuKV0sCiAgICBbJ1RyYW5zYWN0ZWQnLGZtdCh0eG4pKyhuPycgKCcrTWF0aC5yb3VuZCh0eG4vbioxMDApKyclKSc6JycpXSwKICAgIFsnVHJhbnNhY3Rpb24gdmFsdWUnLG1vbmV5KHZhbCldLAogICAgWydNZW1iZXJzaGlwcycsZm10KHJlYyldLAogICAgWydJbiBhIHBpcGVsaW5lJyxmbXQoaW5QaXBlKV0sCiAgICBbJ0Nsb3NlZC13b24nLGZtdCh3b24pXQogIF07CiAgJCgnam91cm5leUNhcmRzJykuaW5uZXJIVE1MPWNhcmRzLm1hcChmdW5jdGlvbihjKXtyZXR1cm4gJzxkaXYgY2xhc3M9ImpjYXJkIj48ZGl2IGNsYXNzPSJsYWIiPicrY1swXSsnPC9kaXY+PGRpdiBjbGFzcz0idmFsIj4nK2NbMV0rJzwvZGl2PjwvZGl2Pic7fSkuam9pbignJyk7CiAgLy8gc3RhZ2UgZGlzdHJpYnV0aW9uIG5vdGUKICB2YXIgYnlTdGFnZT17fTtjb250YWN0cy5mb3JFYWNoKGZ1bmN0aW9uKGMpe2lmKGMuc3RhZ2Upe3ZhciBrPShjLnBpcGVsaW5lP2MucGlwZWxpbmUrJyDCtyAnOicnKStjLnN0YWdlO2J5U3RhZ2Vba109KGJ5U3RhZ2Vba118fDApKzE7fX0pOwogIHZhciB0b3A9T2JqZWN0LmtleXMoYnlTdGFnZSkubWFwKGZ1bmN0aW9uKGspe3JldHVybiBbayxieVN0YWdlW2tdXTt9KS5zb3J0KGZ1bmN0aW9uKGEsYil7cmV0dXJuIGJbMV0tYVsxXTt9KS5zbGljZSgwLDQpOwogIHZhciBub3RlPXRvcC5sZW5ndGg/KCdDdXJyZW50IHN0YWdlczogJyt0b3AubWFwKGZ1bmN0aW9uKHQpe3JldHVybiB0WzBdKycgKCcrdFsxXSsnKSc7fSkuam9pbignLCAnKSsnLicpOicnOwogIGlmKERBVEEuZ2hsJiZEQVRBLmdobC5jb250YWN0c0NhcHBlZClub3RlKz0nIEpvdXJuZXkgc2FtcGxlZCBmcm9tIHRoZSBtb3N0IHJlY2VudCAnK0RBVEEuZ2hsLmNvbnRhY3RzQ2FwcGVkKycgY29udGFjdHMuJzsKICAkKCdqb3VybmV5Tm90ZScpLnRleHRDb250ZW50PW5vdGU7CiAgLy8gZW1haWwgYmxvY2sKICB2YXIgZW09REFUQS5naGwmJkRBVEEuZ2hsLmVtYWlsOwogIGlmKGVtJiZlbS50b3RhbHMpeyQoJ2VtYWlsQmxvY2snKS5jbGFzc0xpc3QucmVtb3ZlKCdoaWRlJyk7dmFyIHQ9ZW0udG90YWxzOyQoJ2VtYWlsQm9keScpLnRleHRDb250ZW50PSdTZW50ICcrZm10KHQuc2VudCkrJywgZGVsaXZlcmVkICcrZm10KHQuZGVsaXZlcmVkKSsnLCBvcGVuZWQgJytmbXQodC5vcGVuZWQpKycgKCcrTWF0aC5yb3VuZCgoZW0ucmF0ZXMub3Blbnx8MCkqMTAwKSsnJSksIGNsaWNrZWQgJytmbXQodC5jbGlja2VkKSsnICgnK01hdGgucm91bmQoKGVtLnJhdGVzLmNsaWNrfHwwKSoxMDApKyclKS4gU291cmNlOiAnK2VtLnNvdXJjZSsnLic7fQogIGVsc2V7JCgnZW1haWxCbG9jaycpLmNsYXNzTGlzdC5hZGQoJ2hpZGUnKTt9Cn0KZnVuY3Rpb24gcmVuZGVyUGlwZXMoKXsKICB2YXIgcGlwZXM9KERBVEEuZ2hsJiZEQVRBLmdobC5waXBlbGluZXMpfHxbXTsKICBpZighcGlwZXMubGVuZ3RoKXskKCdwaXBlcycpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Im11dGVkIj5ObyBwaXBlbGluZSBkYXRhLjwvc3Bhbj4nO3JldHVybjt9CiAgdmFyIGh0bWw9cGlwZXMubWFwKGZ1bmN0aW9uKHApewogICAgdmFyIG1heD1NYXRoLm1heC5hcHBseShudWxsLHAuc3RhZ2VzLm1hcChmdW5jdGlvbihzKXtyZXR1cm4gcy5uO30pLmNvbmNhdChbMV0pKTsKICAgIHZhciByb3dzPXAuc3RhZ2VzLm1hcChmdW5jdGlvbihzKXt2YXIgdz1NYXRoLnJvdW5kKHMubi9tYXgqMTIwKTtyZXR1cm4gJzxkaXYgY2xhc3M9InN0YWdlIj48c3BhbiBjbGFzcz0ibm0iPicrZXNjKHMubmFtZSkrJzwvc3Bhbj48c3BhbiBjbGFzcz0iYmFyIiBzdHlsZT0id2lkdGg6Jyt3KydweCI+PC9zcGFuPjxzcGFuIGNsYXNzPSJjdCI+JytzLm4rKHMudmFsdWU/JyDCtyAnK21vbmV5KHMudmFsdWUpOicnKSsnPC9zcGFuPjwvZGl2Pic7fSkuam9pbignJyk7CiAgICByZXR1cm4gJzxkaXYgY2xhc3M9InBpcGUiPjxoND4nK2VzYyhwLm5hbWUpKyc8L2g0Picrcm93cysnPC9kaXY+JzsKICB9KS5qb2luKCcnKTsKICAkKCdwaXBlcycpLmlubmVySFRNTD1odG1sOwp9CgovLyAtLS0tLS0tLS0tIEtQSXMgLS0tLS0tLS0tLQpmdW5jdGlvbiByZW5kZXJLUElzKCl7CiAgdmFyIHdpbj13aW5kb3dNb250aHMoKSxwcmV2PXByZXZNb250aHMod2luKTsKICB2YXIgY2hmPWN1ckNoYW5uZWwoKSxjaFNmeD1jaGYhPT0nQWxsJz8nICgnK2NoZisnKSc6Jyc7CiAgdmFyIHNlc3M9c3VtQ2god2luLDAsY2hmKSxzZXNzUD1zdW1DaChwcmV2LDAsY2hmKTsKICB2YXIgdXNlcnM9c3VtQ2god2luLDEsY2hmKSx1c2Vyc1A9c3VtQ2gocHJldiwxLGNoZik7CiAgdmFyIGdhZHNDb3N0PXdpbi5yZWR1Y2UoZnVuY3Rpb24oYSxtKXtyZXR1cm4gYStnYWRzTW9udGhBZ2cobSlbMl07fSwwKTsKICB2YXIgZ2Fkc0NvbnY9d2luLnJlZHVjZShmdW5jdGlvbihhLG0pe3JldHVybiBhK2dhZHNNb250aEFnZyhtKVszXTt9LDApOwogIHZhciBnc2NDbGlja3M9d2luLnJlZHVjZShmdW5jdGlvbihhLG0pe3JldHVybiBhKygoREFUQS5nc2MmJkRBVEEuZ3NjLmRhdGEmJkRBVEEuZ3NjLmRhdGFbbV0mJkRBVEEuZ3NjLmRhdGFbbV1bMF0pfHwwKTt9LDApOwogIHZhciBmaWxscz13aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7dmFyIGJtPShEQVRBLmdobCYmREFUQS5naGwuYnlNb250aCYmREFUQS5naGwuYnlNb250aFttXSl8fHt9O3JldHVybiBhK09iamVjdC5rZXlzKGJtKS5yZWR1Y2UoZnVuY3Rpb24ocyxrKXtyZXR1cm4gcytibVtrXTt9LDApO30sMCk7CiAgdmFyIHBpcGVWYWw9KERBVEEuZ2hsJiZEQVRBLmdobC5zdW1tYXJ5JiZEQVRBLmdobC5zdW1tYXJ5Lm9wZW5WYWx1ZSl8fDA7CiAgdmFyIHdvbj0oREFUQS5naGwmJkRBVEEuZ2hsLnN1bW1hcnkmJkRBVEEuZ2hsLnN1bW1hcnkud29uVmFsdWUpfHwwOwogIHZhciBrPVsKICAgIHtsYWI6J1Nlc3Npb25zJytjaFNmeCx2YWw6Zm10KHNlc3MpLGNoZzpjaGdIdG1sKHNlc3Msc2Vzc1ApfSwKICAgIHtsYWI6J1VzZXJzJytjaFNmeCx2YWw6Zm10KHVzZXJzKSxjaGc6Y2hnSHRtbCh1c2Vycyx1c2Vyc1ApfSwKICAgIHtsYWI6J0FkIFNwZW5kJyx2YWw6bW9uZXkoZ2Fkc0Nvc3QpLGNoZzonPHNwYW4gY2xhc3M9ImNoZyBtdXRlZCI+JytmbXQoZ2Fkc0NvbnYpKycgY29udjwvc3Bhbj4nfSwKICAgIHtsYWI6J1NFTyBDbGlja3MnLHZhbDpmbXQoZ3NjQ2xpY2tzKSxjaGc6JzxzcGFuIGNsYXNzPSJjaGcgbXV0ZWQiPm9yZ2FuaWM8L3NwYW4+J30sCiAgICB7bGFiOidGb3JtIEZpbGxzJyx2YWw6Zm10KGZpbGxzKSxjaGc6JzxzcGFuIGNsYXNzPSJjaGcgbXV0ZWQiPkdvSGlnaExldmVsPC9zcGFuPid9LAogICAge2xhYjonT3BlbiBQaXBlbGluZScsdmFsOm1vbmV5KHBpcGVWYWwpLGNoZzonPHNwYW4gY2xhc3M9ImNoZyB1cCI+Jyttb25leSh3b24pKycgd29uPC9zcGFuPid9CiAgXTsKICAkKCdrcGlzJykuaW5uZXJIVE1MPWsubWFwKGZ1bmN0aW9uKHgpe3JldHVybiAnPGRpdiBjbGFzcz0ia3BpIj48ZGl2IGNsYXNzPSJsYWIiPicreC5sYWIrJzwvZGl2PjxkaXYgY2xhc3M9InZhbCI+Jyt4LnZhbCsnPC9kaXY+Jyt4LmNoZysnPC9kaXY+Jzt9KS5qb2luKCcnKTsKfQoKZnVuY3Rpb24gZXNjKHMpe3JldHVybiBTdHJpbmcocz09bnVsbD8nJzpzKS5yZXBsYWNlKC9bJjw+Il0vZyxmdW5jdGlvbihjKXtyZXR1cm4geycmJzonJmFtcDsnLCc8JzonJmx0OycsJz4nOicmZ3Q7JywnIic6JyZxdW90Oyd9W2NdO30pO30KCi8vIC0tLS0tLS0tLS0gYW5hbHlzdCBub3RlcyAocGVyIHJlcG9ydGluZyB3aW5kb3cpIC0tLS0tLS0tLS0KdmFyIExTPSdzaWNvcmFfYW5fJzsKdmFyIEFMTEs9WydzdW1tYXJ5JywnZ2E0JywnZ2FkcycsJ2dzYycsJ2dobCddOwp2YXIgQU5fSURTPXtnYTQ6J2FuX2dhNCcsZ2FkczonYW5fZ2FkcycsZ3NjOidhbl9nc2MnLGdobDonYW5fZ2hsJ307CnZhciBhbkJ1c3k9ZmFsc2U7CmZ1bmN0aW9uIGJvZHlFbChrKXtyZXR1cm4gaz09PSdzdW1tYXJ5Jz8kKCdleGVjU3VtJyk6KGZ1bmN0aW9uKCl7dmFyIHM9JChBTl9JRFNba10pO3JldHVybiBzP3MucXVlcnlTZWxlY3RvcignLmFub3RlLWInKTpudWxsO30pKCk7fQpmdW5jdGlvbiBjdXJTaWcoKXtyZXR1cm4gd2luZG93Ll9fQU5TSUd8fCcnO30KZnVuY3Rpb24gbHNHZXQoayl7dHJ5e3JldHVybiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShMUytjdXJTaWcoKSsnXycrayk7fWNhdGNoKGUpe3JldHVybiBudWxsO319CmZ1bmN0aW9uIGxzU2V0KGssdil7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKExTK2N1clNpZygpKydfJytrLHYpO31jYXRjaChlKXt9fQpmdW5jdGlvbiBzZXRUZXh0KGssdCl7dmFyIGVsPWJvZHlFbChrKTtpZighZWwpcmV0dXJuO2VsLnRleHRDb250ZW50PXQ7aWYodCYmdCE9PSfigJQnKWVsLnJlbW92ZUF0dHJpYnV0ZSgnZGF0YS1lbXB0eScpO2Vsc2UgZWwuc2V0QXR0cmlidXRlKCdkYXRhLWVtcHR5JywnMScpO30KZnVuY3Rpb24gcmVzdG9yZVNhdmVkKCl7QUxMSy5mb3JFYWNoKGZ1bmN0aW9uKGspe3ZhciB2PWxzR2V0KGspO2lmKHYhPW51bGwpc2V0VGV4dChrLHYpO30pO3ZhciBhPWxzR2V0KCdhY3Rpb25zJyk7aWYoYSE9bnVsbCkkKCdhY3Rpb25MaXN0JykuaW5uZXJIVE1MPWE7fQpmdW5jdGlvbiBidWlsZFNuYXAoKXsKICB2YXIgd2luPXdpbmRvd01vbnRocygpLHByZXY9cHJldk1vbnRocyh3aW4pOwogIHZhciBMPW1MYWJlbCh3aW5bMF0pKyh3aW4ubGVuZ3RoPjE/J+KAkycrbUxhYmVsKHdpblt3aW4ubGVuZ3RoLTFdKTonJyk7CiAgdmFyIHM9J1NpY29yYSBDb25zdWx0aW5nIOKAlCAnK0wrJyB2cyAnKygkKCdmX2NtcCcpLnZhbHVlPT09J3llYXInPydwcmV2aW91cyB5ZWFyJzoncHJldmlvdXMgcGVyaW9kJykrJy5cbic7CiAgcys9J0dBNDogc2Vzc2lvbnMgJytmbXQoc3VtTWV0cmljKHdpbiwwKSkrJyB2cyAnK2ZtdChzdW1NZXRyaWMocHJldiwwKSkrJzsgdXNlcnMgJytmbXQoc3VtTWV0cmljKHdpbiwxKSkrJzsga2V5IGV2ZW50cyAnK2ZtdChzdW1NZXRyaWMod2luLDQpKSsnLlxuJzsKICB2YXIga2VTdHI9KERBVEEua2VOYW1lc3x8W10pLm1hcChmdW5jdGlvbihuLGkpe3JldHVybiBbcHJldHR5S0Uobiksc3VtS0Uod2luLGkpXTt9KS5maWx0ZXIoZnVuY3Rpb24oeCl7cmV0dXJuIHhbMV0+MDt9KS5zbGljZSgwLDYpLm1hcChmdW5jdGlvbih4KXtyZXR1cm4geFswXSsnICcrZm10KHhbMV0pO30pLmpvaW4oJywgJyk7CiAgaWYoa2VTdHIpcys9J0dBNCBrZXkgZXZlbnRzIGJ5IHR5cGU6ICcra2VTdHIrJy5cbic7CiAgdmFyIGdjPXdpbi5yZWR1Y2UoZnVuY3Rpb24oYSxtKXtyZXR1cm4gYStnYWRzTW9udGhBZ2cobSlbMl07fSwwKSxndj13aW4ucmVkdWNlKGZ1bmN0aW9uKGEsbSl7cmV0dXJuIGErZ2Fkc01vbnRoQWdnKG0pWzNdO30sMCk7CiAgcys9J0dvb2dsZSBBZHM6IHNwZW5kICcrbW9uZXkoZ2MpKycsIGNvbnZlcnNpb25zICcrZm10KGd2KSsnLCBDUEEgJysoZ3Y/bW9uZXkoZ2MvZ3YpOiduL2EnKSsnLlxuJzsKICB2YXIgZ2NsPXdpbi5yZWR1Y2UoZnVuY3Rpb24oYSxtKXtyZXR1cm4gYSsoKERBVEEuZ3NjJiZEQVRBLmdzYy5kYXRhJiZEQVRBLmdzYy5kYXRhW21dJiZEQVRBLmdzYy5kYXRhW21dWzBdKXx8MCk7fSwwKTsKICBzKz0nU2VhcmNoIENvbnNvbGU6IGNsaWNrcyAnK2ZtdChnY2wpKycuXG4nOwogIHZhciBzbT0oREFUQS5naGwmJkRBVEEuZ2hsLnN1bW1hcnkpfHx7fTt2YXIgZm9ybXM9KERBVEEuZ2hsJiZEQVRBLmdobC5mb3Jtcyl8fFtdOwogIHMrPSdHb0hpZ2hMZXZlbDogJytmbXQoc20uZm9ybUZpbGxzfHwwKSsnIGZvcm0gZmlsbHMgYWNyb3NzICcrZm9ybXMubGVuZ3RoKycgZm9ybXMgKCcrZm9ybXMuc2xpY2UoMCw0KS5tYXAoZnVuY3Rpb24oZil7cmV0dXJuIGYubmFtZSsnICcrZi50b3RhbDt9KS5qb2luKCcsICcpKycpLiBPcGVuIHBpcGVsaW5lICcrbW9uZXkoc20ub3BlblZhbHVlfHwwKSsnLCB3b24gJyttb25leShzbS53b25WYWx1ZXx8MCkrJyAoJysoc20ud29uQ291bnR8fDApKycgZGVhbHMpLCAnKyhzbS5sb3N0Q291bnR8fDApKycgbG9zdC4gU291cmNlczogJytPYmplY3Qua2V5cyhEQVRBLmdobCYmREFUQS5naGwuc291cmNlc3x8e30pLnNsaWNlKDAsNSkubWFwKGZ1bmN0aW9uKGspe3JldHVybiBwcmV0dHlTcmMoaykrJyAnK0RBVEEuZ2hsLnNvdXJjZXNba107fSkuam9pbignLCAnKSsnLic7CiAgd2luZG93Ll9fU05BUD1zOwogIHdpbmRvdy5fX0FOU0lHPSQoJ2ZfdGYnKS52YWx1ZSsnfCcrJCgnZl9jbXAnKS52YWx1ZTsKfQpmdW5jdGlvbiByZW5kZXJBY3Rpb25zKHZhbCl7dmFyIGVsPSQoJ2FjdGlvbkxpc3QnKTtpZihBcnJheS5pc0FycmF5KHZhbCkmJnZhbC5sZW5ndGgpe2VsLmlubmVySFRNTD0nPG9sIHN0eWxlPSJtYXJnaW46MDtwYWRkaW5nLWxlZnQ6MThweCI+Jyt2YWwubWFwKGZ1bmN0aW9uKGEpe3JldHVybiAnPGxpIHN0eWxlPSJtYXJnaW46MCAwIDZweCI+Jytlc2MoYSkrJzwvbGk+Jzt9KS5qb2luKCcnKSsnPC9vbD4nO2VsLnJlbW92ZUF0dHJpYnV0ZSgnZGF0YS1lbXB0eScpO2xzU2V0KCdhY3Rpb25zJyxlbC5pbm5lckhUTUwpO31lbHNlIGlmKHR5cGVvZiB2YWw9PT0nc3RyaW5nJyl7ZWwudGV4dENvbnRlbnQ9dmFsO2VsLnNldEF0dHJpYnV0ZSgnZGF0YS1lbXB0eScsJzEnKTt9fQpmdW5jdGlvbiBnZW5lcmF0ZUFuYWx5c2lzKGZvcmNlKXsKICBpZihhbkJ1c3kpcmV0dXJuOwogIGlmKCFmb3JjZSl7dmFyIGFueT1BTExLLnNvbWUoZnVuY3Rpb24oayl7cmV0dXJuIGxzR2V0KGspIT1udWxsO30pO2lmKGFueSl7cmVzdG9yZVNhdmVkKCk7cmV0dXJuO319CiAgYW5CdXN5PXRydWU7dmFyIGJ0bj0kKCdhbkJ0bicpO2lmKGJ0bil7YnRuLmRpc2FibGVkPXRydWU7YnRuLnRleHRDb250ZW50PSdBbmFseXppbmfigKYnO30KICBBTExLLmZvckVhY2goZnVuY3Rpb24oayl7c2V0VGV4dChrLCdBbmFseXppbmfigKYnKTt9KTtyZW5kZXJBY3Rpb25zKCdBbmFseXppbmfigKYnKTsKICBmZXRjaCgnL2FwaS9hbmFseXplJyx7bWV0aG9kOidQT1NUJyxoZWFkZXJzOnsnY29udGVudC10eXBlJzonYXBwbGljYXRpb24vanNvbid9LGJvZHk6SlNPTi5zdHJpbmdpZnkoe2NvbnRleHQ6d2luZG93Ll9fU05BUHx8Jyd9KX0pCiAgLnRoZW4oZnVuY3Rpb24ocil7cmV0dXJuIHIuanNvbigpLnRoZW4oZnVuY3Rpb24oail7cmV0dXJue29rOnIub2ssajpqfTt9KTt9KQogIC50aGVuKGZ1bmN0aW9uKHgpe2lmKCF4Lm9rKXRocm93IG5ldyBFcnJvcigoeC5qJiZ4LmouZXJyb3IpfHwnZXJyb3InKTt2YXIgaj14Lmo7CiAgICBBTExLLmZvckVhY2goZnVuY3Rpb24oayl7dmFyIHQ9KGs9PT0nc3VtbWFyeSc/ai5zdW1tYXJ5Ompba10pfHwnTm8gbm90YWJsZSBjaGFuZ2UgaW4gdGhpcyB2aWV3Lic7c2V0VGV4dChrLHQpO2xzU2V0KGssdCk7fSk7CiAgICByZW5kZXJBY3Rpb25zKEFycmF5LmlzQXJyYXkoai5hY3Rpb25zKT9qLmFjdGlvbnM6bnVsbCk7CiAgfSkKICAuY2F0Y2goZnVuY3Rpb24oKXt2YXIgbXNnPSdBbmFseXNpcyBydW5zIG9uIHRoZSBsaXZlIGRhc2hib2FyZCAobmVlZHMgdGhlIHNlcnZlciBjb25uZWN0aW9uKS4nO0FMTEsuZm9yRWFjaChmdW5jdGlvbihrKXtzZXRUZXh0KGssbXNnKTt9KTtyZW5kZXJBY3Rpb25zKG1zZyk7fSkKICAuZmluYWxseShmdW5jdGlvbigpe2FuQnVzeT1mYWxzZTtpZihidG4pe2J0bi5kaXNhYmxlZD1mYWxzZTtidG4udGV4dENvbnRlbnQ9J1JlZ2VuZXJhdGUgYW5hbHlzaXMnO319KTsKfQoKLy8gLS0tLS0tLS0tLSBRJkEgLS0tLS0tLS0tLQpmdW5jdGlvbiBhc2soKXt2YXIgcT0kKCdhc2tRJykudmFsdWUudHJpbSgpO2lmKCFxKXJldHVybjskKCdhc2tBbnMnKS50ZXh0Q29udGVudD0nVGhpbmtpbmfigKYnOwogIGZldGNoKCcvYXBpL2Fzaycse21ldGhvZDonUE9TVCcsaGVhZGVyczp7J2NvbnRlbnQtdHlwZSc6J2FwcGxpY2F0aW9uL2pzb24nfSxib2R5OkpTT04uc3RyaW5naWZ5KHtxdWVzdGlvbjpxLGNvbnRleHQ6d2luZG93Ll9fU05BUHx8Jyd9KX0pCiAgLnRoZW4oZnVuY3Rpb24ocil7cmV0dXJuIHIuanNvbigpO30pLnRoZW4oZnVuY3Rpb24oail7JCgnYXNrQW5zJykudGV4dENvbnRlbnQ9ai5hbnN3ZXJ8fGouZXJyb3J8fCdObyBhbnN3ZXIuJzt9KQogIC5jYXRjaChmdW5jdGlvbigpeyQoJ2Fza0FucycpLnRleHRDb250ZW50PSdTb21ldGhpbmcgd2VudCB3cm9uZy4nO30pO30KCi8vIC0tLS0tLS0tLS0gZmlsdGVyIHBvcHVsYXRpb24gLS0tLS0tLS0tLQpmdW5jdGlvbiBwb3B1bGF0ZUZpbHRlcnMoKXsKICBpZihmaWx0ZXJzUmVhZHkpcmV0dXJuO2ZpbHRlcnNSZWFkeT10cnVlOwogIHZhciBjaD0kKCdmX2NoJyk7aWYoY2gpY2guaW5uZXJIVE1MPSc8b3B0aW9uIHZhbHVlPSJBbGwiPkFsbCBDaGFubmVsczwvb3B0aW9uPicrKERBVEEuY2hhbm5lbHN8fFtdKS5tYXAoZnVuY3Rpb24oYyl7cmV0dXJuICc8b3B0aW9uPicrZXNjKGMpKyc8L29wdGlvbj4nO30pLmpvaW4oJycpOwogIHZhciByZz0kKCdmX3JlZycpO2lmKHJnKXJnLmlubmVySFRNTD0nPG9wdGlvbiB2YWx1ZT0iQWxsIj5BbGwgUmVnaW9uczwvb3B0aW9uPicrKChEQVRBLnJlZ05hbWVzfHxbXSkuZmlsdGVyKGZ1bmN0aW9uKG4pe3JldHVybiBuIT09J090aGVyJzt9KSkubWFwKGZ1bmN0aW9uKGMpe3JldHVybiAnPG9wdGlvbj4nK2VzYyhjKSsnPC9vcHRpb24+Jzt9KS5qb2luKCcnKTsKICB2YXIgY3Q9JCgnZl9jaXR5Jyk7aWYoY3QpY3QuaW5uZXJIVE1MPSc8b3B0aW9uIHZhbHVlPSJBbGwiPkFsbCBDaXRpZXM8L29wdGlvbj4nKygoREFUQS5jaXR5TmFtZXN8fFtdKS5maWx0ZXIoZnVuY3Rpb24obil7cmV0dXJuIG4hPT0nT3RoZXInO30pKS5tYXAoZnVuY3Rpb24oYyl7cmV0dXJuICc8b3B0aW9uPicrZXNjKGMpKyc8L29wdGlvbj4nO30pLmpvaW4oJycpOwogIHZhciBrZT0kKCdmX2tlJyk7aWYoa2Upa2UuaW5uZXJIVE1MPSc8b3B0aW9uIHZhbHVlPSJhbGwiPkFsbCBLZXkgRXZlbnRzPC9vcHRpb24+JytrZU5hbWVzKCkubWFwKGZ1bmN0aW9uKG4saSl7cmV0dXJuICc8b3B0aW9uIHZhbHVlPSInK2krJyI+Jytlc2MobikrJzwvb3B0aW9uPic7fSkuam9pbignJyk7Cn0KZnVuY3Rpb24gc3luY0N1c3RvbVJhbmdlKCl7CiAgdmFyIHRmPSQoJ2ZfdGYnKS52YWx1ZSxjdz0kKCdjdXN0b21XcmFwJyk7aWYoIWN3KXJldHVybjsKICBjdy5zdHlsZS5kaXNwbGF5PXRmPT09J2N1c3RvbSc/Jyc6J25vbmUnOwogIGlmKHRmPT09J2N1c3RvbScpe3ZhciBmZj0kKCdmX2Zyb20nKSx0dD0kKCdmX3RvJyksQT1hbmNob3JZTSgpLHRvST1mdW5jdGlvbih5bSl7cmV0dXJuIHltLnNsaWNlKDAsNCkrJy0nK3ltLnNsaWNlKDQpO307CiAgICBpZihmZiYmIWZmLnZhbHVlKWZmLnZhbHVlPXRvSSh5bUFkZChBLC0yKSk7aWYodHQmJiF0dC52YWx1ZSl0dC52YWx1ZT10b0koQSk7fQp9Ci8vIC0tLS0tLS0tLS0gcmVuZGVyIG9yY2hlc3RyYXRpb24gLS0tLS0tLS0tLQpmdW5jdGlvbiByZW5kZXIoKXsKICBwb3B1bGF0ZUZpbHRlcnMoKTtzeW5jQ3VzdG9tUmFuZ2UoKTsKICBidWlsZFNuYXAoKTsKICAkKCd3aW5MYWJlbCcpLnRleHRDb250ZW50PXdpbmRvdy5fX1NOQVAuc3BsaXQoJ1xuJylbMF0ucmVwbGFjZSgnU2ljb3JhIENvbnN1bHRpbmcg4oCUICcsJycpOwogIHJlbmRlcktQSXMoKTtyZW5kZXJHQTQoKTtyZW5kZXJHYWRzKCk7cmVuZGVyR1NDKCk7cmVuZGVyRm9ybUZpbHRlcigpO3JlbmRlckdITEZvcm1zKCk7cmVuZGVySm91cm5leSgpO3JlbmRlclBpcGVzKCk7CiAgJCgnZ2VuQXQnKS50ZXh0Q29udGVudD1EQVRBLmdlbmVyYXRlZEF0PygnVXBkYXRlZCAnK25ldyBEYXRlKERBVEEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlbi1VUycse21vbnRoOidzaG9ydCcsZGF5OidudW1lcmljJyxob3VyOidudW1lcmljJyxtaW51dGU6JzItZGlnaXQnfSkpOicnOwogICQoJ2J1aWxkTm8nKS50ZXh0Q29udGVudD0nQnVpbGQgJysoREFUQS5idWlsZHx8Jz8nKTsKICAkKCdsaXZlTGFiZWwnKS50ZXh0Q29udGVudD0oREFUQS5tb250aHMmJkRBVEEubW9udGhzLmxlbmd0aCk/J0xpdmUgZGF0YSc6J1NhbXBsZSBkYXRhJzsKICAvLyBhbmFseXNpczogcmVnZW5lcmF0ZSBvbiB3aW5kb3cgY2hhbmdlCiAgaWYod2luZG93Ll9fQU5TSUchPT13aW5kb3cuX19BTlNJR19sYXN0KXt3aW5kb3cuX19BTlNJR19sYXN0PXdpbmRvdy5fX0FOU0lHO2lmKHdpbmRvdy5fX2FuSW5pdClnZW5lcmF0ZUFuYWx5c2lzKGZhbHNlKTt9Cn0KWydmX3RmJywnZl9jbXAnLCdmX21ldHJpYycsJ2ZfY2gnLCdmX3JlZycsJ2ZfY2l0eScsJ2Zfa2UnLCdmX2Zyb20nLCdmX3RvJ10uZm9yRWFjaChmdW5jdGlvbihpZCl7dmFyIGVsPSQoaWQpO2lmKGVsKWVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScscmVuZGVyKTt9KTsKJCgnYW5CdG4nKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsZnVuY3Rpb24oKXtpZihjb25maXJtKCdSZWdlbmVyYXRlIGFsbCBhbmFseXNpcyBmcm9tIHRoZSBsaXZlIGRhdGE/IFRoaXMgcmVwbGFjZXMgeW91ciBlZGl0cyBmb3IgdGhpcyB2aWV3LicpKWdlbmVyYXRlQW5hbHlzaXModHJ1ZSk7fSk7CiQoJ2Fza0dvJykuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLGFzayk7CiQoJ2Fza1EnKS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJyxmdW5jdGlvbihlKXtpZihlLmtleT09PSdFbnRlcicpYXNrKCk7fSk7CgpyZW5kZXIoKTsKZ2VuZXJhdGVBbmFseXNpcyhmYWxzZSk7CndpbmRvdy5fX2FuSW5pdD10cnVlOwoKLy8gQ2hhcnQuanMgZmFsbGJhY2sgaWYgdGhlIHNhbWUtb3JpZ2luIGZpbGUgbWlzc2VkCmlmKHR5cGVvZiBDaGFydD09PSd1bmRlZmluZWQnKXt2YXIgY3M9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7Y3Muc3JjPSdodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2NoYXJ0LmpzQDQuNC4xL2Rpc3QvY2hhcnQudW1kLm1pbi5qcyc7Y3Mub25sb2FkPWZ1bmN0aW9uKCl7SEFTQ0hBUlQ9dHJ1ZTt0cnl7cmVuZGVyKCk7fWNhdGNoKGUpe319O2RvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoY3MpO30KPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";
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
