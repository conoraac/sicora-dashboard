# Sicora Consulting Performance Dashboard

A single-file Node/Express app (`server.js`) that serves a one-page marketing dashboard for Sicora Consulting (sicoraconsulting.com). Cloned from the BBZ dashboard. Full build spec in `SICORA-BUILD-BRIEF.md`.

- **Repo:** github.com/conoraac/sicora-dashboard, branch `main`.
- **Host:** Railway (`npm start`). Push to `main` → Railway auto-redeploys. Verify every deploy at `GET /api/health` (no login).
- **Client:** full context in the Astoria cowork system at `AI_Cowork_System/Projects/Sicora_Consulting/client_brain.md`.

## Architecture you must understand before editing

- The frontend (`index.html`) and `snapshot.json` (cold-start fallback data) are **base64-embedded inside `server.js`** as `INDEX_B64` / `SNAPSHOT_B64`, decoded at runtime. Live data is injected at the `/*__DATA__*/` placeholder.
- **Never hand-edit the base64.** Workflow:
  1. `node embed.mjs extract` → writes `index.html` + `snapshot.json` out of server.js
  2. edit `index.html` / `snapshot.json`
  3. `node embed.mjs` → re-encode them back into `server.js`
  4. `node --check server.js` before every commit
  5. bump `const BUILD = N` near the top so `/api/health` confirms the new code is live
- For large edits, use scripts (python) rather than hand-editing server.js.

## Data sources (Windsor.ai REST, same key as BBZ)

- GA4: property **"Sicora GA4"** (id 251028744). **Filter GA4 by `account_name`, NOT `account_id`** — `account_id` is not a valid GA4 dimension. Scope GA4 to Sicora.
- Google Ads: **470-137-4429**
- Search Console: URL-prefix property **"https://sicoraconsulting.com/"** (verbatim, NOT sc-domain).
- GoHighLevel: location **h0Iu6JkLutDW09474iZ5**, via `ghl-integration.js`.

### GHL is the centerpiece
- Form submissions with a **multi-select form filter**, marketing-source breakdown, and a **form-filler journey** (transactions/memberships, current pipeline + stage).
- Data model: GHL has no "form" entity — **`contact_source` IS the form name**, **`contact_original_source` is the marketing channel**. Three pipelines (PPC+SEO, Rule of 5, Self Service). Transactions/orders join by contact id.
- **Email opens/clicks are NOT available** via Windsor or GHL's public API (dashboard-only). `ghl-integration.js` best-efforts an unofficial endpoint and hides cleanly if missing. For true email engagement, wire Sicora's ESP.

No CallRail.

## Auth

Env-only, fails closed (no hardcoded fallbacks). `USERS` in server.js → env var: robert@sicoraconsulting.com (PW_ROBERT), magnus@sicoraconsulting.com (PW_MAGNUS), lorri@sicoraconsulting.com (PW_LORRI), lorrimguimond@gmail.com (PW_LORRI_GMAIL), gus@astoriaadvertising.co (PW_GUS), jason@astoriaadvertising.co (PW_JASON). Plus conor@astoriaadvertising.co (PW_CONOR).

## Env vars (Railway)

`WINDSOR_API_KEY`, `ANTHROPIC_API_KEY`, optional `GHL_API_KEY`, the seven `PW_*` vars (see .env.example), optional `MODEL` (default claude-sonnet-4-6). See `.env.example`.

## Theme

Orange accent `#f58459`, blue secondary `#405ba4`, white background.

## Current state

Build 1. Verified locally (charts render, multi-select journey rollups correct, bad password → 401). Pushed to `main`. NOT yet deployed to Railway (create the service + set env vars).
