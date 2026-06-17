# Sicora Consulting Dashboard — Build Brief

Cloned from the BBZ Limousine dashboard (single-file Express app, base64-embedded
frontend, live Windsor.ai pulls). This brief is the source of truth for what Sicora's
dashboard must contain and how it differs from BBZ. Built by Astoria Advertising.

## 1. Scope (per Conor, 2026-06-17)

Sicora's dashboard covers **four data areas**:

1. **GA4** — sessions/users/channels/key events (reuse BBZ's `buildGA4`, swap property).
2. **Google Ads** — spend/clicks/conversions, campaign drill-down (reuse BBZ's `buildGads*`).
3. **Google Search Console** — clicks/impressions/position + top queries (reuse BBZ's `buildGSC*`).
4. **GoHighLevel (GHL)** — the centerpiece, see §4. Form submissions, sources, the
   form-filler journey (transactions/memberships, pipeline+stage), and email engagement.

**Not included:** CallRail, Meta/Facebook, Google Business Profile, IQ CRM (all BBZ-only — strip them).

## 2. Sicora accounts in Windsor (verified live 2026-06-17)

| Connector | Windsor slug | Account / property | Filter field |
|---|---|---|---|
| GA4 | `googleanalytics4` | **Sicora GA4** (id `251028744`) | `account_name` = `Sicora GA4` (NOT account_id — Google rejects it) |
| Google Ads | `google_ads` | **Sicora Consulting** (id `470-137-4429`) | `account_id` |
| Search Console | `searchconsole` | **`https://sicoraconsulting.com/`** (URL-prefix property, NOT `sc-domain:`) | code-filter on `account_id`, `serverFilter:false` |
| GoHighLevel | `gohighlevel` | **Sicora Consulting** (id `h0Iu6JkLutDW09474iZ5`) | `account_id` (only one GHL account on this key) |

GA4 gotcha carries over verbatim from BBZ: this Windsor key has 8 GA4 properties, so GA4
MUST be scoped by `account_name` via `windsor('googleanalytics4', 'Sicora GA4', …, {acctField:'account_name', serverFilter:false})` and filtered in code. Sequential GA4 queries (no concurrency) to avoid rate limits.

## 3. GHL data model (reverse-engineered from live `get_fields` + `get_data`)

Tables exposed by the Windsor `gohighlevel` connector: **Location, Contacts, Conversations,
Invoices, Opportunities, Orders, Pipelines, Transactions, Users.**

### 3a. Forms & sources
- **There is no dedicated "form" entity.** `contact_source` IS the form/source label for
  GHL-native submissions. Confirmed live Sicora values: `Contact Us`, `4 Colors of Insights Contact`,
  `PPC - Insights Discovery Landing Page`, `membership`, `Calendly`, `Test`, and a large block of
  `HubSpot Migration` (legacy imports — NOT form fills).
- **Source/channel** of a fill lives in `contact_original_source` (e.g. `PAID_SEARCH`,
  `ORGANIC_SEARCH`, `DIRECT_TRAFFIC`, `EMAIL_MARKETING`, `PAID_SOCIAL`, `SOCIAL_MEDIA`, `REFERRALS`,
  `OFFLINE`) with finer detail in `contact_original_source_detail_1` (landing-page URL or keyword).
  For native GHL forms `original_source` is null → fall back to `contact_source`.
- **Form-name filter (multi-select):** dimension = `contact_source`. Exclude `HubSpot Migration`,
  `Test`, and null from the "form submissions" view by default (treat as imports/noise), but keep
  them available. "PPC submissions" = forms whose `contact_source` contains `PPC` OR
  `original_source` = `PAID_SEARCH`. "PPC vs SEO" = `PAID_SEARCH` vs `ORGANIC_SEARCH`.
- Key date field for contacts: use `date` (default). `contact_date_added` is NOT a valid
  `date_filters` field — do not pass it as a date filter (Windsor rejects it).

### 3b. Pipelines (verified live — hardcode names from `pipeline_stages` or resolve at runtime)
Three pipelines, each with named stages (resolve `opportunity_pipeline_stage_id` → stage name via the
`Pipelines` table `pipeline_stages` object):
- **PPC + SEO** (`KhRGnWZAolyEaJdw2xSk`): New Lead → Initial Outreach Sent → Discovery Call Scheduled →
  Discovery Call Complete → Proposal Sent → Contract Sent → Cancelled → Closed-Won → Closed-Lost
- **Rule of 5** (`o7LSxKgSYZA89VKHyDN9`): Touch 1→2→3 → Response Received → Conversation Active →
  Meeting Scheduled → Closed-Won → Closed-Lost
- **Self Service** (`CAc4sA9sh16psmuZRFIw`): New Lead → Assessment for Purchase Email Sent →
  Assessment Payment Made → Assessment In Progress → Assessment Complete → Upsell Opportunity →
  Closed-Won → Closed-Lost

Opportunities join to contacts via `opportunity_contact_id` / `opportunity_contact_email`.
Monetary value: `opportunity_monetary_value`; status: `opportunity_status` (open/won/lost).

### 3c. Transactions & memberships (form-filler journey)
- **Transactions** table: `transaction_contact_id`, `transaction_amount`, `transaction_status`,
  `transaction_created_at`. **Orders** table: `order_contact_id`, `order_amount`,
  `order_recurring_products` (>0 ≈ membership/subscription), `order_status`.
- Journey join: contact → transactions/orders by contact id/email → did they transact? total value?
  recurring (membership) yes/no?

### 3d. Email engagement — NOT in Windsor (the one gap)
Windsor's GHL feed exposes **no** email sent/open/click counts (only `contact_email_status`,
`contact_behavioral_engagement` status strings and `Conversations` last-message metadata).
**Decision (Conor): build a direct GoHighLevel API integration** (`ghl-integration.js`, modeled on
`iq-integration.js`). See §5.

## 4. GHL dashboard sections to build

1. **Form submissions** — count of contacts by `contact_source` (form), with a **multi-select form
   filter** (select one or many forms at once). Trend by month. Split by `original_source` (PPC vs SEO
   vs Direct vs Email vs Social vs Referral).
2. **Sources** — breakdown of fills by `contact_original_source` (+ drill to `_detail_1`).
3. **Form-filler journey** (per selected form set, or overall): of the contacts who filled the
   selected form(s) — how many transacted, total transaction/order value, how many on a recurring
   product (membership); which pipeline + stage they're currently in (funnel by pipeline);
   email engagement (received/opened/clicked) from the direct GHL API (§5).
4. **Pipeline visibility** — open opportunities by pipeline & stage, monetary value, win rate.

## 5. Direct GHL API integration (`ghl-integration.js`)

- Modeled on `iq-integration.js`: reads `GHL_API_KEY` (+ `GHL_LOCATION_ID`, default the Sicora
  location `h0Iu6JkLutDW09474iZ5`) from env; falls back to the baked snapshot when unset so the page
  still renders.
- Purpose: pull **email engagement** the Windsor feed lacks. GoHighLevel LeadConnector API v2
  (`https://services.leadconnectorhq.com`), `Version: 2021-07-28` header, Bearer token.
- ⚠️ **Verify before relying on it:** GHL's public API exposes email *campaign/statistics*
  (sent/delivered/opened/clicked aggregates) more readily than *per-contact* open/click history.
  When the token is available, confirm which endpoint returns engagement and at what grain. If
  per-contact opens/clicks aren't available, show campaign-level email stats and label the journey's
  email metric as campaign-level, not per-contact.
- Token handling: set `GHL_API_KEY` in Railway env (and locally for testing) — do NOT paste it into
  chat. A GHL **Private Integration Token** for the Sicora location with email/conversations read
  scopes is the cleanest credential.

## 6. Env vars (`.env.example`)

```
ANTHROPIC_API_KEY=          # AI analyst notes / Q&A (server-side)
WINDSOR_API_KEY=            # live data (same key as BBZ — it has Sicora's accounts)
GA4_ACCOUNT_NAME=Sicora GA4
GA4_ACCOUNT=251028744
GADS_ACCOUNT=470-137-4429
GSC_ACCOUNT=https://sicoraconsulting.com/
GHL_ACCOUNT=h0Iu6JkLutDW09474iZ5
GHL_API_KEY=                # direct GHL API (email engagement)
GHL_LOCATION_ID=h0Iu6JkLutDW09474iZ5
MODEL=claude-sonnet-4-6
PW_CONOR=                   # auth users (fail closed — no fallbacks, per BBZ build 50)
PW_SICORA=                  # Sicora client login
AUTH_SALT=sicora-dash-v1
```

## 7. Auth
Reuse BBZ build-50 pattern exactly: `USERS` maps emails → `process.env.PW_*` with **no hardcoded
fallbacks**; `VALID_TOKENS` filters out users with no password (fails closed); 3 keys → AUTH_ENABLED
always true. Users: `conor@astoriaadvertising.co` (PW_CONOR) + a Sicora client contact (PW_SICORA,
email TBD from Conor).

## 8. Deploy (own repo + Railway service)
New private GitHub repo + new Railway service "Sicora-Dashboard". Same workflow as BBZ:
`node embed.mjs extract` → edit `index.html`/`snapshot.json` → `node embed.mjs` → `node --check
server.js` → bump `BUILD` → commit/push → confirm at `/api/health`. Conor creates the repo + Railway
service + env vars; this build produces the code + a setup checklist.

## 9. Build status / TODO
- [x] Discovery: Sicora accounts, GHL data model, pipelines, gap analysis
- [x] Scaffold project from BBZ
- [ ] server.js: config head (accounts/branding/auth/sections), strip BBZ-only builders
- [ ] server.js: GHL Windsor builders (forms, sources, pipeline, transactions)
- [ ] ghl-integration.js: direct GHL API for email engagement
- [ ] index.html: Sicora sections + multi-select form filter + journey view
- [ ] snapshot.json: Sicora cold-start sample
- [ ] /api/health + analyst-note prompt updated for Sicora channels
- [ ] Build brief handed to Conor + Railway/env checklist
```
