process.env.SR_NO_START = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createProxyServer, PORT, HOST } = require('../service.js');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function call(port, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path, headers: opts.headers || {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function setup(t, handler, proxyOpts) {
  const seen = [];
  const up = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  const upPort = await listen(up);
  const proxy = createProxyServer(proxyOpts);
  const port = await listen(proxy);
  t.after(() => {
    [up, proxy].forEach((s) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(); });
  });
  return { port, upPort, seen, base: 'http://127.0.0.1:' + upPort };
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

test('constants', () => {
  assert.equal(PORT, 8765);
  assert.equal(HOST, '127.0.0.1');
});

test('GET is forwarded with path, query and api key; response relayed with CORS', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, { results: [1] }));
  const r = await call(s.port, {
    path: '/proxy/api/v1/search?query=Am%C3%A9lie%20%26%20Co&page=1',
    headers: { 'X-Seerr-Url': s.base, 'X-Api-Key': 'KEY', Accept: 'application/json' }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { results: [1] });
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.match(r.headers['content-type'], /application\/json/);
  assert.equal(s.seen[0].url, '/api/v1/search?query=Am%C3%A9lie%20%26%20Co&page=1');
  assert.equal(s.seen[0].headers['x-api-key'], 'KEY');
});

test('only whitelisted headers are forwarded', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  await call(s.port, { path: '/proxy/api/v1/auth/me', headers: { 'X-Seerr-Url': s.base, 'X-Api-Key': 'K', Cookie: 'secret=1', Authorization: 'Bearer x' } });
  assert.equal(s.seen[0].headers.cookie, undefined);
  assert.equal(s.seen[0].headers.authorization, undefined);
  assert.equal(s.seen[0].headers['x-seerr-url'], undefined);
});

test('POST body and content-type are forwarded; upstream 409 passes through unchanged', async (t) => {
  const s = await setup(t, (req, res) => json(res, 409, { message: 'exists' }));
  const body = JSON.stringify({ mediaType: 'tv', mediaId: 1396, seasons: [1, 2] });
  const r = await call(s.port, {
    method: 'POST', path: '/proxy/api/v1/request', body,
    headers: { 'X-Seerr-Url': s.base, 'X-Api-Key': 'K', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  });
  assert.equal(r.status, 409);
  assert.deepEqual(JSON.parse(r.text), { message: 'exists' });
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(s.seen[0].method, 'POST');
  assert.equal(s.seen[0].body, body);
  assert.equal(s.seen[0].headers['content-type'], 'application/json');
});

test('Seerr base URL with a sub-path keeps the prefix', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  await call(s.port, { path: '/proxy/api/v1/status', headers: { 'X-Seerr-Url': s.base + '/seerr/', 'X-Api-Key': 'K' } });
  assert.equal(s.seen[0].url, '/seerr/api/v1/status');
});

test('OPTIONS preflight answers 204 with allow-headers', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  const r = await call(s.port, { method: 'OPTIONS', path: '/proxy/api/v1/auth/me', headers: { Origin: 'http://127.0.0.1:8081', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  const allow = r.headers['access-control-allow-headers'];
  ['x-seerr-url', 'x-api-key', 'content-type'].forEach((h) => assert.ok(allow.indexOf(h) !== -1, h));
  assert.equal(s.seen.length, 0);
});

test('/health reports ok', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  const r = await call(s.port, { path: '/health' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { ok: true });
});

test('paths outside /api/v1 or with traversal are rejected without reaching upstream', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  const h = { 'X-Seerr-Url': s.base, 'X-Api-Key': 'K' };
  for (const p of ['/proxy/settings', '/proxy/api/v2/x', '/proxy/api/v1/../admin', '/proxy/api/v1/a/../../b', '/proxy/']) {
    const r = await call(s.port, { path: p, headers: h });
    assert.equal(r.status, 403, p);
    assert.equal(r.headers['access-control-allow-origin'], '*');
  }
  assert.equal(s.seen.length, 0);
});

test('missing or invalid X-Seerr-Url is a 400', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  for (const v of [undefined, '', 'ftp://example.com', 'notaurl', 'http://']) {
    const headers = { 'X-Api-Key': 'K' };
    if (v !== undefined) headers['X-Seerr-Url'] = v;
    const r = await call(s.port, { path: '/proxy/api/v1/status', headers });
    assert.equal(r.status, 400, String(v));
  }
  assert.equal(s.seen.length, 0);
});

test('unknown routes are 404 and other methods 405', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  assert.equal((await call(s.port, { path: '/nope' })).status, 404);
  const r = await call(s.port, { method: 'DELETE', path: '/proxy/api/v1/request/1', headers: { 'X-Seerr-Url': s.base } });
  assert.equal(r.status, 405);
  assert.equal(s.seen.length, 0);
});

test('unreachable upstream is a JSON 502 with CORS headers', async (t) => {
  const dead = http.createServer();
  const deadPort = await listen(dead);
  await new Promise((r) => dead.close(r));
  const s = await setup(t, (req, res) => json(res, 200, {}));
  const r = await call(s.port, { path: '/proxy/api/v1/status', headers: { 'X-Seerr-Url': 'http://127.0.0.1:' + deadPort, 'X-Api-Key': 'K' } });
  assert.equal(r.status, 502);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(typeof JSON.parse(r.text).message, 'string');
});

test('hanging upstream is a JSON 504 after the timeout', async (t) => {
  const s = await setup(t, () => { /* never respond */ }, { timeoutMs: 80 });
  const r = await call(s.port, { path: '/proxy/api/v1/status', headers: { 'X-Seerr-Url': s.base, 'X-Api-Key': 'K' } });
  assert.equal(r.status, 504);
  assert.equal(r.headers['access-control-allow-origin'], '*');
});

test('service.js uses only Node-4-compatible syntax', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service.js'), 'utf8')
    .replace(/\/\/.*$/gm, '')                 // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');        // block comments
  const banned = [
    [/\basync\b/, 'async'], [/\bawait\b/, 'await'], [/\.\.\./, 'spread/rest'], [/\?\./, 'optional chaining'],
    [/\?\?/, 'nullish coalescing'], [/`/, 'template literal'], [/\*\*/, 'exponent'],
    [/\b(?:var|let|const)\s*[\[{]/, 'destructuring'], [/\(\s*\w+\s*=[^=>]/, 'default param']
  ];
  banned.forEach(([re, name]) => assert.equal(re.test(src), false, 'service.js uses ' + name));
});

test('requiring service.js with SR_NO_START does not listen', () => {
  assert.equal(typeof createProxyServer, 'function');
});
