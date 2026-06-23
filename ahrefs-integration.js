// ahrefs-integration.js
// Direct Ahrefs API v3 integration for the SEO/backlinks section. Ahrefs is NOT in Windsor, so this
// module reads AHREFS_API_KEY and pulls Site Explorer data for sicoraconsulting.com.
//
// Endpoints (verified live 2026-06-18 against api.ahrefs.com/v3):
//   site-explorer/domain-rating      -> { domain_rating:{ domain_rating, ahrefs_rank } }
//   site-explorer/backlinks-stats    -> { metrics:{ live, all_time, live_refdomains, all_time_refdomains } }
//   site-explorer/metrics            -> { metrics:{ org_keywords, org_keywords_1_3, org_traffic, org_cost(¢), paid_keywords, paid_traffic, ... } }
//   site-explorer/metrics-history    -> { metrics:[ { date, org_traffic, paid_traffic } ] }   (select must include date)
//   site-explorer/refdomains-history -> { refdomains:[ { date, refdomains } ] }
//   site-explorer/organic-keywords   -> { keywords:[ { keyword, best_position, volume, sum_traffic } ] }
//   site-explorer/top-pages          -> { pages:[ { url, sum_traffic, keywords, top_keyword } ] }
//
// Monetary values from Ahrefs are in USD cents — divided to dollars here.
// Ahrefs API units are limited and the data changes slowly, so results are cached in-process for 24h
// (the main dashboard refresh runs every 10 min; we do NOT want an Ahrefs pull on every one).

const AHREFS_KEY  = process.env.AHREFS_API_KEY || '';
const AHREFS_TARGET = process.env.AHREFS_TARGET || 'sicoraconsulting.com';
const BASE = 'https://api.ahrefs.com/v3/site-explorer';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

let _cache = { t: 0, data: null };

const today = () => new Date().toISOString().slice(0, 10);
function monthsAgo(n) { const d = new Date(); d.setMonth(d.getMonth() - n); d.setDate(1); return d.toISOString().slice(0, 10); }
const ymOf = s => { const d = String(s); return d.slice(0, 4) + d.slice(5, 7); }; // "2026-06-01T..." -> "202606"

async function ahrefs(endpoint, params, timeoutMs = 25000) {
  const qs = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/${endpoint}?${qs}`, {
      headers: { 'Authorization': 'Bearer ' + AHREFS_KEY, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error('Ahrefs ' + endpoint + ' HTTP ' + r.status + ': ' + (await r.text()).slice(0, 160));
    return await r.json();
  } finally { clearTimeout(t); }
}

// AI search visibility: how often each AI assistant cites the domain (Ahrefs ai-responses-count).
// ~105 units/call and changes slowly, so cache per UTC day. Ported from the Psynth dashboard.
const AI_PLATFORMS = [
  ['ChatGPT', 'chatgpt'], ['Google AI Overviews', 'google_ai_overviews'], ['Google AI Mode', 'google_ai_mode'],
  ['Gemini', 'gemini'], ['Perplexity', 'perplexity'], ['Copilot', 'copilot'], ['Grok', 'grok'],
];
let _aiCache = { date: '', data: null };
export async function buildAiVisibility() {
  if (!AHREFS_KEY) return null;
  const date = today();
  if (_aiCache.date === date && _aiCache.data) return _aiCache.data;   // one paid call per day
  try {
    const r = await ahrefs('ai-responses-count', {
      target: AHREFS_TARGET, mode: 'subdomains', date,
      select: AI_PLATFORMS.map(p => p[1]).join(','),
    });
    const c = (r && r.ai_responses_count) ? r.ai_responses_count : null;
    if (!c) return _aiCache.data || null;
    const platforms = AI_PLATFORMS.map(([label, key]) => ({
      label, key,
      citations: c[key] ? +c[key].citations || 0 : 0,
      pages: c[key] ? +c[key].pages || 0 : 0,
    }));
    const out = { date, platforms, total: platforms.reduce((s, p) => s + p.citations, 0) };
    _aiCache = { date, data: out };
    return out;
  } catch (e) { console.error('AI visibility:', e.message); return _aiCache.data || null; }
}

export async function buildAhrefs() {
  if (!AHREFS_KEY) return null;                              // no key → frontend uses baked snapshot
  if (_cache.data && Date.now() - _cache.t < TTL_MS) return _cache.data;

  const target = AHREFS_TARGET, date = today(), mode = 'subdomains';
  const dom = { mode, protocol: 'both' };
  // Fire the calls; tolerate partial failures so one bad endpoint doesn't blank the section.
  const safe = (p) => p.catch(e => { console.error('Ahrefs:', e.message); return null; });
  const [dr, bl, mx, mh, rh, kw, pg] = await Promise.all([
    safe(ahrefs('domain-rating', { target, date })),
    safe(ahrefs('backlinks-stats', { target, date, ...dom })),
    safe(ahrefs('metrics', { target, date, ...dom })),
    safe(ahrefs('metrics-history', { target, ...dom, history_grouping: 'monthly', date_from: monthsAgo(12), date_to: date, select: 'date,org_traffic,paid_traffic' })),
    safe(ahrefs('refdomains-history', { target, ...dom, history_grouping: 'monthly', date_from: monthsAgo(12), date_to: date })),
    safe(ahrefs('organic-keywords', { target, date, ...dom, select: 'keyword,best_position,volume,sum_traffic', order_by: 'sum_traffic:desc', limit: 50 })),
    safe(ahrefs('top-pages', { target, date, ...dom, select: 'url,sum_traffic,keywords,top_keyword', order_by: 'sum_traffic:desc', limit: 50 })),
  ]);

  const m = (mx && mx.metrics) || {};
  const data = {
    target, date,
    dr: dr && dr.domain_rating ? +dr.domain_rating.domain_rating || 0 : null,
    ahrefsRank: dr && dr.domain_rating ? +dr.domain_rating.ahrefs_rank || 0 : null,
    backlinks: bl && bl.metrics ? {
      live: +bl.metrics.live || 0, allTime: +bl.metrics.all_time || 0,
      refdomains: +bl.metrics.live_refdomains || 0, allTimeRefdomains: +bl.metrics.all_time_refdomains || 0,
    } : null,
    metrics: {
      orgKeywords: +m.org_keywords || 0, orgKeywords13: +m.org_keywords_1_3 || 0,
      orgTraffic: +m.org_traffic || 0, orgCost: Math.round((+m.org_cost || 0) / 100),
      paidKeywords: +m.paid_keywords || 0, paidTraffic: +m.paid_traffic || 0,
    },
    trafficHistory: (mh && Array.isArray(mh.metrics) ? mh.metrics : []).map(r => ({
      ym: r.date ? ymOf(r.date) : null, org: +r.org_traffic || 0, paid: +r.paid_traffic || 0,
    })).filter(r => r.ym),
    refdomainsHistory: (rh && Array.isArray(rh.refdomains) ? rh.refdomains : []).map(r => ({
      ym: ymOf(r.date), n: +r.refdomains || 0,
    })),
    keywords: (kw && Array.isArray(kw.keywords) ? kw.keywords : []).map(r => ({
      kw: r.keyword, pos: +r.best_position || 0, vol: +r.volume || 0, traffic: +r.sum_traffic || 0,
    })),
    pages: (pg && Array.isArray(pg.pages) ? pg.pages : []).map(r => ({
      url: r.url, traffic: +r.sum_traffic || 0, keywords: +r.keywords || 0, topKw: r.top_keyword || '',
    })),
    generatedAt: new Date().toISOString(),
  };
  // require at least DR or metrics to consider it usable
  if (data.dr == null && !data.metrics.orgKeywords && !data.keywords.length) return null;
  _cache = { t: Date.now(), data };
  return data;
}
