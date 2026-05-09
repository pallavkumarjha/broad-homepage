# broad-homepage

Marketing page for the Broad rider app, plus a thin API proxy to the Railway backend.

## Structure

- `index.html` — static landing page (served at `/`).
- `privacy.html`, `terms.html`, `support.html` — legal and support pages.
- `favicon.svg` — SVG favicon (compass needle in brand colours).
- `og-image.png` — social share card (1200×630, **create before launch**).
- `apple-touch-icon.png` — iOS home screen icon (180×180 PNG, **create before launch**).
- `robots.txt` / `sitemap.xml` — search engine directives.
- `404.html` — custom not-found page.
- `api/proxy.js` — Vercel Serverless Function that proxies every `/api/*` request to the Railway backend.
- `vercel.json` — rewrite rule (required) + security and cache headers.

## Proxy

The proxy exists so the mobile app can reach the backend over Vercel's Mumbai edge, which Indian mobile carriers (Jio/Airtel/Vi) route to reliably — the direct Railway/Fastly route is flaky.

Routing: `vercel.json` rewrites `/api/:path*` → `/api/proxy?path=:path*`. The Vercel zero-config `[...slug].js` catch-all convention did not honour multi-segment paths on a no-framework project, so the explicit rewrite is required.

Set `BACKEND_ORIGIN` in Vercel environment variables to override the Railway URL without a code change (falls back to the hardcoded production URL if unset).

## Deployment

Vercel auto-deploys on push to `main`.

To test the proxy locally:

```bash
vercel dev
curl http://localhost:3000/api/auth/ping
```

## Before launch checklist

- [ ] Create `og-image.png` (1200×630) and `apple-touch-icon.png` (180×180)
- [ ] Replace `https://broad.app` with the real production domain in `index.html`, `sitemap.xml`, and `robots.txt`
- [ ] Set `BACKEND_ORIGIN` env var in Vercel dashboard
- [ ] Add real App Store and Google Play URLs in `index.html`
- [ ] Set up analytics (Plausible or GA4)
