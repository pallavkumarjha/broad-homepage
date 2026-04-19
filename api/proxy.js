// Catch-all proxy: forwards every /api/* request to the Broad Railway backend.
//
// Routing: `vercel.json` rewrites `/api/:path*` → `/api/proxy?path=:path*`.
// Vercel's zero-config functions didn't honour the `[...slug].js` catch-all
// convention for multi-segment paths on this project (a known flake when
// there's no framework), so the explicit rewrite is the reliable path.
//
// Why this exists: Indian mobile carriers (Jio/Airtel/Vi) intermittently
// fail to route to Railway's Fastly edge. Vercel's Mumbai POP is reliably
// reachable from those carriers, so the phone talks to Vercel and Vercel
// (over its own backbone) talks to Railway.
//
// Runtime: Node.js (not Edge) so we can stream request bodies up to 20MB —
// Glovebox document uploads could blow past Edge's 4.5MB cap.

const ORIGIN = 'https://broad-backend-production.up.railway.app';

// Hop-by-hop + auto-managed headers we must not forward.
// https://datatracker.ietf.org/doc/html/rfc7230#section-6.1
const HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length', // re-derived by the runtime from the outgoing body
]);

const handler = async (req, res) => {
  const started = Date.now();
  try {
    // `path` comes from the vercel.json rewrite's `:path*` capture. Depending
    // on Vercel's version it arrives as either a single string ("auth/login")
    // or an array (["auth", "login"]); handle both.
    let rawPath = req.query.path;
    if (Array.isArray(rawPath)) rawPath = rawPath.join('/');
    const pathStr = (rawPath || '').replace(/^\/+/, '');

    // Carry forward the client's own query string, stripping the `path` param
    // our rewrite injected.
    const u = new URL(req.url, 'http://internal');
    u.searchParams.delete('path');
    const qs = u.searchParams.toString();
    const target = `${ORIGIN}/api/${pathStr}${qs ? `?${qs}` : ''}`;

    // Copy headers, dropping hop-by-hop.
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP.has(k.toLowerCase())) continue;
      headers[k] = Array.isArray(v) ? v.join(',') : v;
    }
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    if (clientIp) headers['x-forwarded-for'] = clientIp;

    // Raw body for non-idempotent methods.
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    res.status(upstream.status);

    // Mirror response headers, stripping hop-by-hop + content-encoding
    // (Vercel may re-encode; sending a mismatched encoding header breaks
    // clients trying to decompress).
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP.has(lower)) return;
      if (lower === 'content-encoding') return;
      res.setHeader(key, value);
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);

    const ms = Date.now() - started;
    console.log(`[proxy] ${req.method} /api/${pathStr} → ${upstream.status} (${ms}ms)`);
  } catch (err) {
    console.error('[proxy] error:', err);
    res.status(502).json({
      detail: `Proxy error: ${(err && err.message) || String(err)}`,
    });
  }
};

// Disable Vercel's automatic JSON body parser so binary uploads
// (multipart/form-data, image/jpeg) pass through untouched.
handler.config = {
  api: { bodyParser: false },
};

module.exports = handler;
