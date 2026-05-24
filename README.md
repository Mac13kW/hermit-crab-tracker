# 🦀 Hermit Crab Watch — Deployment Guide

A community map for reporting hermit crab sightings worldwide.
Built with Leaflet + OpenStreetMap, Cloudflare Pages, Cloudflare Workers, and D1.

---

## Prerequisites

- A [Cloudflare account](https://cloudflare.com) (free)
- [Node.js](https://nodejs.org) installed (for Wrangler CLI)
- A domain name (optional — Cloudflare gives you free *.pages.dev and *.workers.dev subdomains)

```bash
npm install -g wrangler
wrangler login
```

---

## Step 1 — Create the D1 database

```bash
wrangler d1 create hermit-crabs
```

Copy the `database_id` printed in the output and paste it into `wrangler.toml`.

---

## Step 2 — Run the schema

```bash
# For production:
wrangler d1 execute hermit-crabs --file=schema.sql --remote

# For local testing:
wrangler d1 execute hermit-crabs --file=schema.sql
```

---

## Step 3 — Deploy the Worker (API)

```bash
wrangler deploy
```

Your API will be live at:
`https://hermit-crab-api.YOUR-SUBDOMAIN.workers.dev`

Note this URL — you'll need it in Step 4.

---

## Step 4 — Configure the frontend

In `index.html`, find this line near the bottom:

```js
const API = 'https://hermit-crab-api.YOUR-SUBDOMAIN.workers.dev';
```

Replace it with your actual Worker URL from Step 3.

---

## Step 5 — Deploy the frontend to Cloudflare Pages

**Option A — via Cloudflare dashboard (easiest)**
1. Go to Cloudflare Dashboard → Pages → Create a project
2. Connect your GitHub repo (push index.html to a repo first)
3. Set build output directory to `/` (it's a plain HTML file, no build step)
4. Deploy!

**Option B — via CLI**
```bash
wrangler pages deploy . --project-name hermit-crab-watch
```

Your site will be live at `https://hermit-crab-watch.pages.dev`

---

## Step 6 (optional) — Custom domain

1. Buy a domain from Namecheap or Porkbun (~€10/year)
2. In Cloudflare Pages settings → Custom domains → Add domain
3. Update your domain's nameservers to Cloudflare's (they walk you through it)

---

## Local development

Run the Worker locally with a live-reload database:

```bash
wrangler dev
```

The Worker will be available at `http://localhost:8787`.
Change the `API` constant in index.html to `http://localhost:8787` for local testing.

---

## File overview

```
hermit-crab-tracker/
├── index.html      ← Frontend (map, forms, sidebar)
├── worker.js       ← Cloudflare Worker (REST API)
├── wrangler.toml   ← Worker configuration + D1 binding
├── schema.sql      ← D1 database schema + seed data
└── README.md       ← This file
```

---

## Adding ads (optional, after launch)

Once the site has some traffic, add **Carbon Ads** or **EthicalAds** in index.html:

```html
<!-- Example: Carbon Ads (apply at carbonads.com) -->
<script async src="//cdn.carbonads.com/carbon.js?serve=YOUR_CODE" id="_carbonads_js"></script>
```

Place the snippet in the sidebar or a footer. Don't add ads until you have real users —
it takes time for ad networks to approve new sites.

---

## Spam prevention notes

The Worker already includes:
- Honeypot field in the form (bots fill it, humans don't)
- Basic keyword filtering on submissions
- Rate limiting via Cloudflare's built-in DDoS protection
- Upvote deduplication by IP fingerprint

If spam becomes an issue later, add Cloudflare Turnstile (free CAPTCHA):
https://developers.cloudflare.com/turnstile/

---

## Possible future features

- [ ] Photo upload (Cloudflare R2, free 10GB tier)
- [ ] User accounts (Clerk free tier — "Sign in with Google")
- [ ] Species filter on the map
- [ ] Weekly email digest of new sightings
- [ ] Moderation panel (flag + delete sightings)
- [ ] Export data as CSV for researchers
