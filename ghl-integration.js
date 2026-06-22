// ghl-integration.js
// Direct GoHighLevel (LeadConnector) API integration for EMAIL ENGAGEMENT — the one thing
// Windsor's GHL connector does not expose (sent/opened/clicked). See SICORA-BUILD-BRIEF.md §3d/§5.
//
// ⚠️ IMPORTANT CONSTRAINT (verified 2026-06-17 against GHL's developer docs):
//   GHL's *public* V2 API (services.leadconnectorhq.com) exposes email SENDING but NOT email
//   statistics. Opens/clicks/sent are dashboard-only. The only known stats route is the INTERNAL,
//   UNDOCUMENTED endpoint reporting/emails/aggregate/status, which returns LOCATION-LEVEL aggregates
//   (not per-contact) and is not officially supported (there is an open feature request to expose it).
//   This module therefore:
//     1. Tries the unofficial location-aggregate endpoint when GHL_API_KEY is set.
//     2. Returns null (and the dashboard shows "email engagement not yet available") if it fails.
//   Per-contact email opens/clicks are NOT achievable through GHL's API today. If Sicora needs true
//   per-contact engagement, the marketing email ESP (e.g. HubSpot, which Sicora migrated from) is the
//   real source — wire that connector instead. Talk to Conor before relying on this.
//
// Exports:
//   buildEmail({contacts}) -> { scope, totals:{sent,delivered,opened,clicked,bounced,...}, rates:{open,click}, source } | null

const GHL_KEY        = process.env.GHL_API_KEY || '';
const GHL_LOCATION   = process.env.GHL_LOCATION_ID || process.env.GHL_ACCOUNT || 'h0Iu6JkLutDW09474iZ5';
const GHL_VERSION    = process.env.GHL_API_VERSION || '2021-07-28';
const PUBLIC_BASE    = 'https://services.leadconnectorhq.com';
const INTERNAL_BASE  = 'https://backend.leadconnectorhq.com';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function getJSON(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + GHL_KEY, 'Version': GHL_VERSION, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error('GHL HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Normalize whatever the aggregate endpoint returns into a flat totals object.
// GHL's internal payload shape is not contractually stable, so read defensively.
function normalizeAggregate(j) {
  const root = (j && (j.aggregate || j.data || j.stats || j)) || {};
  const g = (...keys) => { for (const k of keys) { if (root[k] != null) return num(root[k]); } return 0; };
  const sent      = g('sent', 'totalSent', 'requests', 'delivered_and_bounced');
  const delivered = g('delivered', 'totalDelivered');
  const opened    = g('opened', 'uniqueOpened', 'opens', 'totalOpened');
  const clicked   = g('clicked', 'uniqueClicked', 'clicks', 'totalClicked');
  const bounced   = g('bounced', 'totalBounced', 'bounces');
  const unsub     = g('unsubscribed', 'totalUnsubscribed', 'unsubscribes');
  const base = delivered || sent;
  return {
    totals: { sent, delivered, opened, clicked, bounced, unsubscribed: unsub },
    rates: { open: base ? opened / base : 0, click: base ? clicked / base : 0 },
  };
}

// Last-90-days window by default; the endpoint expects epoch-ms or ISO depending on version,
// so we pass both styles and let the server ignore the one it doesn't use.
function defaultWindow() {
  const to = new Date();
  const from = new Date(); from.setMonth(from.getMonth() - 3);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export async function buildEmail(_ctx = {}) {
  if (!GHL_KEY) return null;                 // no key → dashboard renders without the email block
  const { from, to } = defaultWindow();
  // Unofficial location-aggregate endpoint. May change/break without notice.
  const url = `${INTERNAL_BASE}/reporting/emails/aggregate/status`
    + `?locationId=${encodeURIComponent(GHL_LOCATION)}`
    + `&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`;
  try {
    const j = await getJSON(url);
    const n = normalizeAggregate(j);
    if (!n.totals.sent && !n.totals.delivered && !n.totals.opened) return null; // nothing usable
    return { scope: 'location', window: { from, to }, ...n, source: 'ghl-internal-aggregate (unofficial)' };
  } catch (e) {
    // Endpoint not available on this token / not public. Fail soft.
    return null;
  }
}

// ---- Marketing source via direct GHL API attribution ----
// Windsor's GHL feed nulls out original_source/UTMs for native form fills. The LeadConnector API,
// however, carries per-contact attribution (utmSource / sessionSource / medium / referrer). We page
// the contacts endpoint (recent first, capped + time-budgeted) and aggregate source counts per form
// (contact.source == form/source label) so the dashboard can show a real, form-filterable source mix.
function sourceLabel(a) {
  if (!a || typeof a !== 'object') return 'Direct';
  let s = a.utmSource || a.utm_source || a.sessionSource || a.medium || a.utmMedium || a.referrer || '';
  s = String(s || '').trim();
  if (!s || /^(null|undefined|direct|\(direct\)|none)$/i.test(s)) return 'Direct';
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0]; // referrer URL -> domain
  // tidy common values
  const map = { google: 'Google', 'google.com': 'Google', bing: 'Bing', facebook: 'Facebook', 'facebook.com': 'Facebook',
    fb: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', 'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn',
    youtube: 'YouTube', 't.co': 'X/Twitter', twitter: 'X/Twitter', 'chatgpt.com': 'ChatGPT', 'duckduckgo.com': 'DuckDuckGo' };
  const k = s.toLowerCase();
  return map[k] || s.replace(/\b\w/g, c => c.toUpperCase());
}
function attrOf(c) {
  return c.attributionSource || c.attribution_source
    || (Array.isArray(c.attributions) && c.attributions[0])
    || c.lastAttributionSource || c.last_attribution_source || null;
}
// Search keyword passed in on a paid click (utm_term / gclid keyword). GHL names vary, so try several.
function keywordOf(a) {
  if (!a || typeof a !== 'object') return '';
  const k = a.utmTerm || a.utm_term || a.utmKeyword || a.utm_keyword || a.keyword || a.term || a.adKeyword || '';
  return String(k || '').trim();
}
function gclidOf(a) {
  if (!a || typeof a !== 'object') return '';
  return String(a.gclid || a.gclId || a.gclid || a.gbraid || a.wbraid || '').trim();
}
const cid = c => c.id || c.contactId || c.contact_id || c._id || null;

// valueByContact: { contactId: wonRevenue } — lets us aggregate keyword/source -> won revenue.
export async function buildContactSources({ cap = 4000, budgetMs = 25000, valueByContact = {} } = {}) {
  if (!GHL_KEY) return null;
  const started = Date.now();
  const byForm = {}, overall = {}, srcRev = {}, kw = {};
  let url = `${PUBLIC_BASE}/contacts/?locationId=${encodeURIComponent(GHL_LOCATION)}&limit=100`;
  let fetched = 0, withAttr = 0, withKeyword = 0, withGclid = 0, sampleKeys = null;
  try {
    while (url && fetched < cap && (Date.now() - started) < budgetMs) {
      const j = await getJSON(url);
      const contacts = j.contacts || j.data || [];
      if (!Array.isArray(contacts) || !contacts.length) break;
      for (const c of contacts) {
        fetched++;
        const form = c.source || '(none)';
        const a = attrOf(c);
        const rev = +valueByContact[cid(c)] || 0;
        if (a && (a.utmSource || a.sessionSource || a.medium || a.referrer)) withAttr++;
        if (a && !sampleKeys && Object.keys(a).length) sampleKeys = Object.keys(a);
        const src = sourceLabel(a);
        (byForm[form] || (byForm[form] = {}))[src] = (byForm[form][src] || 0) + 1;
        overall[src] = (overall[src] || 0) + 1;
        const sr = srcRev[src] || (srcRev[src] = { n: 0, revenue: 0 }); sr.n++; sr.revenue += rev;
        const term = keywordOf(a);
        if (gclidOf(a)) withGclid++;
        if (term) { withKeyword++; const o = kw[term] || (kw[term] = { n: 0, revenue: 0 }); o.n++; o.revenue += rev; }
      }
      const meta = j.meta || j.pagination || {};
      const next = meta.nextPageUrl || meta.next_page_url || null;
      if (next) { url = next; }
      else if (meta.startAfterId || meta.startAfter) {
        url = `${PUBLIC_BASE}/contacts/?locationId=${encodeURIComponent(GHL_LOCATION)}&limit=100`
          + (meta.startAfter ? `&startAfter=${encodeURIComponent(meta.startAfter)}` : '')
          + (meta.startAfterId ? `&startAfterId=${encodeURIComponent(meta.startAfterId)}` : '');
      } else { url = null; }
    }
  } catch (e) {
    if (!Object.keys(overall).length) return null; // nothing usable
  }
  const keywords = Object.entries(kw).map(([term, o]) => ({ kw: term, n: o.n, revenue: o.revenue }))
    .sort((a, b) => b.revenue - a.revenue || b.n - a.n).slice(0, 50);
  const sources = Object.entries(srcRev).map(([s, o]) => ({ source: s, n: o.n, revenue: o.revenue }))
    .sort((a, b) => b.revenue - a.revenue || b.n - a.n);
  return { byForm, overall, sources, keywords, contacts: fetched, withAttribution: withAttr,
    withKeyword, withGclid, sampleKeys, source: 'ghl-api-attribution' };
}

export { normalizeAggregate, sourceLabel };
