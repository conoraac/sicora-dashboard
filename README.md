# Sicora Consulting — Performance Dashboard

Single-file Node/Express app (`server.js`) serving one branded, password-gated page with LIVE
marketing data (GA4 + Google Ads + Search Console + GoHighLevel) and AI analyst notes.
Cloned from the BBZ dashboard. Full spec: **SICORA-BUILD-BRIEF.md**.

## Architecture (same as BBZ)
- `index.html` (UI) and `snapshot.json` (cold-start fallback) are **base64-embedded** in `server.js`
  as `INDEX_B64` / `SNAPSHOT_B64`. Live data is injected at the `/*__DATA__*/` placeholder.
- **Never hand-edit the base64.** Workflow:
  1. `node embed.mjs extract` → writes `index.html` + `snapshot.json` out of `server.js`
  2. edit `index.html` / `snapshot.json`
  3. `node embed.mjs` → re-encodes them into `server.js`
  4. `node --check server.js` before every commit
- Bump `const BUILD` every deploy so `/api/health` confirms the live build.
- Data: Windsor.ai REST (`windsor()`), GA4 scoped by `account_name`, GHL via the `gohighlevel`
  connector, plus a best-effort direct GHL API for email (`ghl-integration.js`).

## Sections
GA4 traffic · Google Ads · Search Console · GoHighLevel (form submissions with a multi-select
form filter, marketing-source breakdown, form-filler journey, pipeline visibility) · AI exec
summary + per-channel analyst notes + Q&A.

## Setup checklist (Conor)
1. **Create a new private GitHub repo** (e.g. `sicora-dashboard`) and push this folder to `main`.
   (Run `git init` is already done locally — just add the remote and push.)
2. **Create a new Railway service** "Sicora-Dashboard" pointed at that repo. Start command: `npm start`.
3. **Set Railway env vars** (see `.env.example`):
   - `ANTHROPIC_API_KEY` — required for analyst notes / Q&A.
   - `WINDSOR_API_KEY` — the same Windsor key used for BBZ (it has Sicora's accounts).
   - `PW_CONOR`, `PW_SICORA` — login passwords (no fallbacks; a blank var = that login disabled).
   - `AUTH_SALT` — any stable random string.
   - GA4/GADS/GSC/GHL account vars only if you ever need to override the built-in defaults.
   - `GHL_API_KEY` — leave blank for now (GHL email stats not reliably available; see brief §3d).
4. **Confirm the Sicora login email** in `server.js` `USERS` (currently the placeholder
   `client@sicoraconsulting.com` → `PW_SICORA`). Replace with the real Sicora contact email,
   re-embed is NOT needed (it's plain server code), just commit + push.
5. **Verify** at `https://<service>.up.railway.app/api/health` → `build`, `liveDataReady:true`,
   `windsorKeySet:true`, and the `sections` counts (ga4Months, ghlForms, ghlPipelines, etc.).

## Local dev
```
npm install
PW_CONOR=Test123! WINDSOR_API_KEY=... ANTHROPIC_API_KEY=... npm start
# http://localhost:3000  (without WINDSOR_API_KEY it serves the bundled snapshot)
```
