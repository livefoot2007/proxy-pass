const http = require('node:http');
const https = require('node:https');

const port = Number(process.env.PORT || 8080);
const upstreamUrl = process.env.UPSTREAM_URL;
const upstreamPath = process.env.UPSTREAM_PATH;
const upstreamBearerToken = process.env.UPSTREAM_BEARER_TOKEN;
const upstreamAccept = process.env.UPSTREAM_ACCEPT || 'application/json';
const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 30000);

function log(message, details = {}) {
  process.stdout.write(`${JSON.stringify({
    time: new Date().toISOString(),
    message,
    ...details,
  })}\n`);
}

function parseBodyParams(body, contentType = '') {
  if (!body.length) return {};
  const text = body.toString('utf8');

  try {
    if (contentType.includes('application/json')) return JSON.parse(text);
    if (contentType.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(text));
    }
    if (contentType.includes('multipart/form-data')) {
      const fields = {};
      for (const part of text.split(/\r?\n--[^\r\n]+(?:--)?\r?\n/)) {
        const match = part.match(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)(?:\r?\n)?$/);
        if (match) fields[match[1]] = match[2];
      }
      return fields;
    }
  } catch {
    return { parseError: true };
  }
  return {};
}

function maskToken(token) {
  if (!token) return null;
  if (token.length <= 6) return '******';
  return `${token.slice(0, 3)}****${token.slice(-3)}`;
}

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
  const startedAt = Date.now();
  const requestPath = req.url || '/';
  const incoming = new URL(requestPath, 'http://proxy.invalid');
  const requestLog = {
    method: req.method,
    path: requestPath,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    contentType: req.headers['content-type'] || null,
    contentLength: req.headers['content-length'] || null,
    queryParams: Object.fromEntries(incoming.searchParams),
  };

  const bodyChunks = [];
  req.on('data', (chunk) => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(bodyChunks);
    log('Incoming request', {
      ...requestLog,
      bodyParams: parseBodyParams(body, req.headers['content-type'] || ''),
    });

    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      log('Request completed', { ...requestLog, status: 200, durationMs: Date.now() - startedAt });
      return;
    }

    // The incoming path/query is appended to the configured upstream base URL.
    const target = new URL(upstream);
    target.pathname = upstreamPath
      ? upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`
      : `${upstream.pathname.replace(/\/$/, '')}/${incoming.pathname.replace(/^\//, '')}`;
    target.search = incoming.search;
    const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host || '' };
    // Add a valid request timestamp for receivers that display/parse the Date header.
    headers.date = new Date().toUTCString();
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    headers['content-length'] = body.length;
    headers.accept = upstreamAccept;
    if (upstreamBearerToken) {
      headers.authorization = `Bearer ${upstreamBearerToken}`;
    }

    log('Sending request to upstream', {
      ...requestLog,
      upstream: target.toString(),
      accept: headers.accept || null,
      authorizationForwarded: Boolean(upstreamBearerToken || headers.authorization),
      configuredBearerToken: maskToken(upstreamBearerToken),
    });

    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: req.method,
      headers,
      timeout: timeoutMs,
    }, (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      log('Upstream response', {
        ...requestLog,
        upstream: target.toString(),
        status: response.statusCode || 502,
        durationMs: Date.now() - startedAt,
      });
      response.pipe(res);
    });

    request.on('timeout', () => request.destroy(new Error('upstream timeout')));
    request.on('error', (error) => {
      console.error(`Upstream request failed: ${error.message}`);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      if (!res.writableEnded) res.end('{"error":"upstream_unavailable"}');
    });
    request.end(body);
  });
});

server.listen(port, '0.0.0.0', () => {
  log('HTTP proxy listening', { port });
  log('Upstream configured', {
    upstream: upstream.origin,
    fixedPath: upstreamPath || null,
  });
});
