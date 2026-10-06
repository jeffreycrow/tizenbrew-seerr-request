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

test('malformed upstream URLs never crash the service (bad port is a 400, server stays up)', async (t) => {
  const s = await setup(t, (req, res) => json(res, 200, {}));
  for (const v of ['http://127.0.0.1:99999', 'http://127.0.0.1:0', 'http://127.0.0.1:-1', 'http://127.0.0.1:abc', 'http://exa mple.com', 'http://[::1']) {
    const r = await call(s.port, { path: '/proxy/api/v1/status', headers: { 'X-Seerr-Url': v, 'X-Api-Key': 'K' } });
    assert.ok(r.status === 400 || r.status === 502, v + ' -> ' + r.status);
    assert.equal(r.headers['access-control-allow-origin'], '*');
  }
  const health = await call(s.port, { path: '/health' });
  assert.equal(health.status, 200);
});

// ---- redirects ----

async function twoServers(t, handlerA, handlerB) {
  const seenA = [], seenB = [];
  const mk = (seen, handler) => http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  const a = mk(seenA, handlerA), b = mk(seenB, handlerB || ((req, res) => json(res, 200, { from: 'b' })));
  const aPort = await listen(a), bPort = await listen(b);
  const proxy = createProxyServer();
  const port = await listen(proxy);
  t.after(() => { [a, b, proxy].forEach((s) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(); }); });
  return { port, aPort, bPort, seenA, seenB, baseA: 'http://127.0.0.1:' + aPort };
}

const redirect = (res, code, location) => { res.writeHead(code, { Location: location }); res.end(); };

test('GET redirects on the same host are followed (301/302/307/308), keeping the api key', async (t) => {
  for (const code of [301, 302, 307, 308]) {
    const s = await twoServers(t, (req, res) => (req.url === '/api/v1/old' ? redirect(res, code, '/api/v1/new') : json(res, 200, { ok: code })));
    const r = await call(s.port, { path: '/proxy/api/v1/old', headers: { 'X-Seerr-Url': s.baseA, 'X-Api-Key': 'K' } });
    assert.equal(r.status, 200, String(code));
    assert.deepEqual(JSON.parse(r.text), { ok: code });
    assert.deepEqual(s.seenA.map((x) => x.url), ['/api/v1/old', '/api/v1/new']);
    assert.equal(s.seenA[1].headers['x-api-key'], 'K');
  }
});

test('absolute same-host redirect (different port) is followed', async (t) => {
  const s = await twoServers(t, (req, res) => redirect(res, 307, 'http://127.0.0.1:' + 0 + '/x'), (req, res) => json(res, 200, { from: 'b' }));
  // re-point A at B's port now that it is known
  s.seenA.length = 0;
  const a2 = http.createServer((req, res) => redirect(res, 307, 'http://127.0.0.1:' + s.bPort + '/api/v1/final'));
  const a2Port = await listen(a2);
  t.after(() => { if (a2.closeAllConnections) a2.closeAllConnections(); a2.close(); });
  const r = await call(s.port, { path: '/proxy/api/v1/x', headers: { 'X-Seerr-Url': 'http://127.0.0.1:' + a2Port, 'X-Api-Key': 'K' } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { from: 'b' });
  assert.equal(s.seenB[0].url, '/api/v1/final');
  assert.equal(s.seenB[0].headers['x-api-key'], 'K');
});

test('POST 307/308 replays method and body on the new location', async (t) => {
  const body = JSON.stringify({ mediaType: 'movie', mediaId: 603 });
  for (const code of [307, 308]) {
    const s = await twoServers(t, (req, res) => (req.url === '/api/v1/request' ? redirect(res, code, '/api/v1/request2') : json(res, 201, { id: 1 })));
    const r = await call(s.port, {
      method: 'POST', path: '/proxy/api/v1/request', body,
      headers: { 'X-Seerr-Url': s.baseA, 'X-Api-Key': 'K', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    });
    assert.equal(r.status, 201, String(code));
    assert.equal(s.seenA[1].method, 'POST');
    assert.equal(s.seenA[1].url, '/api/v1/request2');
    assert.equal(s.seenA[1].body, body);
    assert.equal(s.seenA[1].headers['content-type'], 'application/json');
  }
});

test('303 turns a POST into a body-less GET', async (t) => {
  const body = JSON.stringify({ a: 1 });
  const s = await twoServers(t, (req, res) => (req.url === '/api/v1/request' ? redirect(res, 303, '/api/v1/done') : json(res, 200, { done: true })));
  const r = await call(s.port, { method: 'POST', path: '/proxy/api/v1/request', body, headers: { 'X-Seerr-Url': s.baseA, 'X-Api-Key': 'K', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  assert.equal(r.status, 200);
  assert.equal(s.seenA[1].method, 'GET');
  assert.equal(s.seenA[1].body, '');
});

test('a redirect to a different host is refused with a message naming it, and that host is never contacted', async (t) => {
  const s = await twoServers(t, (req, res) => redirect(res, 307, 'http://localhost:' + 0));
  const a2 = http.createServer((req, res) => redirect(res, 307, 'http://localhost:' + s.bPort + '/api/v1/x'));
  const a2Port = await listen(a2);
  t.after(() => { if (a2.closeAllConnections) a2.closeAllConnections(); a2.close(); });
  const r = await call(s.port, { path: '/proxy/api/v1/x', headers: { 'X-Seerr-Url': 'http://127.0.0.1:' + a2Port, 'X-Api-Key': 'K' } });
  assert.equal(r.status, 502);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  const msg = JSON.parse(r.text).message;
  assert.ok(msg.indexOf('localhost:' + s.bPort) !== -1, msg);
  assert.equal(s.seenB.length, 0);
});

test('a redirect loop stops after a few hops with a 502', async (t) => {
  const s = await twoServers(t, (req, res) => redirect(res, 307, '/api/v1/loop'));
  const r = await call(s.port, { path: '/proxy/api/v1/loop', headers: { 'X-Seerr-Url': s.baseA, 'X-Api-Key': 'K' } });
  assert.equal(r.status, 502);
  assert.ok(JSON.parse(r.text).message.toLowerCase().indexOf('redirect') !== -1);
  assert.ok(s.seenA.length <= 7);
});

test('a redirect status without a Location header is relayed as is', async (t) => {
  const s = await twoServers(t, (req, res) => { res.writeHead(307); res.end(); });
  const r = await call(s.port, { path: '/proxy/api/v1/x', headers: { 'X-Seerr-Url': s.baseA, 'X-Api-Key': 'K' } });
  assert.equal(r.status, 307);
  assert.equal(s.seenA.length, 1);
});

test('request bodies over 64 KB are a 413 and never reach the upstream', async (t) => {
  const s = await twoServers(t, (req, res) => json(res, 200, {}));
  const body = 'x'.repeat(70000);
  const r = await call(s.port, { method: 'POST', path: '/proxy/api/v1/request', body, headers: { 'X-Seerr-Url': s.baseA, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  assert.equal(r.status, 413);
  assert.equal(s.seenA.length, 0);
});

test('a redirect from https down to http is refused (the api key must not go out in cleartext)', async (t) => {
  // the https hop is simulated by calling the proxy's follow logic through a real http upstream
  // that claims https:// in Location only when the request itself came over https; here we assert
  // the inverse guard directly: http -> https is allowed to be attempted (same host), https -> http is not.
  const { followDecision } = require('../service.js');
  assert.equal(followDecision('https:', 'http:'), false);
  assert.equal(followDecision('http:', 'https:'), true);
  assert.equal(followDecision('http:', 'http:'), true);
  assert.equal(followDecision('https:', 'https:'), true);
});
