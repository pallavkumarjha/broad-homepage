// Catch-all proxy: forwards every /api/* request to the Broad Railway backend.
//
// Why this exists: Indian mobile carriers (Jio/Airtel/Vi) intermittently fail to
// route to Railway's Fastly edge. Vercel's Mumbai POP is reachable from those
// carriers reliably, so the phone talks to Vercel, and Vercel (over its
// own backbone) talks to Railway.
//
// Runtime: Node.js (not Edge) so we can stream bodies up to 20MB — the
// Glovebox upload endpoint carries document images that could blow past
// Edge's 4.5MB cap.
//
// Routing: Vercel's file-system router maps `api/[...path].js` so that
// /api/auth/login       → req.query.path = ['auth', 'login']
// /api/trips/123/join   → req.query.path = ['trips', '123', 'join']
// We reassemble and forward to `${ORIGIN}/api/<path>?<query>`.

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
    const segments = Array.isArray(req.query.path) ? req.query.path : [];
    const pathStr = segments.join('/');

    // Preserve query string, stripping the `path` param Vercel injected.
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
    // Let the upstream see the real client IP.
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    if (clientIp) headers['x-forwarded-for'] = clientIp;

    // Read raw body for non-idempotent methods.
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

    // Mirror status.
    res.status(upstream.status);

    // Mirror response headers (strip hop-by-hop + content-encoding: Vercel
    // may re-encode, and passing an encoding that doesn't match the body
    // we send causes the client to choke on decompression).
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP.has(lower)) return;
      if (lower === 'content-encoding') return;
      res.setHeader(key, value);
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);

    // Lightweight observability — visible in Vercel runtime logs.
    const ms = Date.now() - started;
    console.log(`[proxy] ${req.method} /api/${pathStr} → ${upstream.status} (${ms}ms)`);
  } catch (err) {
    console.error('[proxy] error:', err);
    res.status(502).json({
      detail: `Proxy error: ${(err && err.message) || String(err)}`,
    });
  }
};

// Disable Vercel's automatic JSON body parser so we can stream binary uploads
// (multipart/form-data, image/jpeg) through untouched.
handler.config = {
  api: { bodyParser: false },
};

module.exports = handler;
