const http = require('node:http');
const https = require('node:https');

const port = Number(process.env.PORT || 8080);
const upstreamUrl = process.env.UPSTREAM_URL;
const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 30000);

if (!upstreamUrl) {
  console.error('Missing required environment variable: UPSTREAM_URL');
  process.exit(1);
}

let upstream;
try {
  upstream = new URL(upstreamUrl);
  if (!['http:', 'https:'].includes(upstream.protocol)) throw new Error('unsupported protocol');
} catch (error) {
  console.error(`Invalid UPSTREAM_URL: ${error.message}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }

  // The incoming path/query is appended to the configured upstream base URL.
  const incoming = new URL(req.url || '/', 'http://proxy.invalid');
  const target = new URL(upstream);
  target.pathname = `${upstream.pathname.replace(/\/$/, '')}/${incoming.pathname.replace(/^\//, '')}`;
  target.search = incoming.search;
  const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host || '' };
  // Add a valid request timestamp for receivers that display/parse the Date header.
  headers.date = new Date().toUTCString();
  delete headers['content-length'];

  const transport = target.protocol === 'https:' ? https : http;
  const request = transport.request(target, {
    method: req.method,
    headers,
    timeout: timeoutMs,
  }, (response) => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });

  request.on('timeout', () => request.destroy(new Error('upstream timeout')));
  request.on('error', (error) => {
    console.error(`Upstream request failed: ${error.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    if (!res.writableEnded) res.end('{"error":"upstream_unavailable"}');
  });
  req.pipe(request);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`HTTP proxy listening on port ${port}`);
  console.log(`Upstream base URL: ${upstream.origin}`);
});
