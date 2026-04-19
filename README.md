# broad-homepage

Marketing page for the Broad rider app, plus a thin API proxy to the Railway backend.

## Structure

- `index.html` — static landing page (served at `/`).
- `api/[...path].js` — catch-all Vercel Function that proxies every `/api/*` request to `https://broad-backend-production.up.railway.app/api/*`. It exists so the mobile app can reach the backend over Vercel's Mumbai edge, which Indian mobile carriers route to reliably (the direct Railway/Fastly route is flaky on Jio/Airtel/Vi).

## Deployment

Vercel auto-deploys on push to `main`. The `api/` folder is auto-detected as serverless functions — no `vercel.json` required.

To test the proxy locally: `vercel dev` (needs Vercel CLI), then `curl http://localhost:3000/api/` — should hit the Railway backend.
