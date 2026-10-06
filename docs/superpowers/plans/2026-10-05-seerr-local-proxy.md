# Seerr Local Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the module work on a real TV by routing Seerr calls through a loopback proxy in TizenBrew's `serviceFile`, because Seerr sends no CORS headers (probe: `OPTIONS` → 405, no `access-control-*`).

**Architecture:** `service.js` is a self-contained ES5-style Node HTTP server on `127.0.0.1:8765` that TizenBrew runs when the module launches. The page probes `GET /health` at startup; if the proxy answers, `api.js` sends every call to `http://127.0.0.1:8765/proxy/api/v1/...` with `X-Seerr-Url` + `X-Api-Key` headers; otherwise it calls Seerr directly (desktop dev).

**Tech Stack:** Node core modules only in the service (`http`, `https`, `url`); tests with `node:test`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-seerr-request-module-design.md` (see "Addendum: local proxy service")

## Global Constraints

- `service.js` must be one self-contained file (TizenBrew fetches only that file from jsDelivr and runs it in a `vm` context with `require`/`module`/`console`/`process`/`Buffer`). No local `require`s.
- `service.js` syntax must stay Node 4.4.3-compatible: `'use strict'`, `var`, plain functions; **no** `async`/`await`, spread/rest (`...`), destructuring, default params, `?.`, `??`, template literals, `**`.
- Proxy listens on `127.0.0.1:8765` only (never `0.0.0.0`). Constants: `PORT = 8765`, page constant `http://127.0.0.1:8765`.
- Only `GET`/`POST`; only paths starting with `/proxy/api/v1/` (no `..` segments); only `http:`/`https:` upstream bases; forward only `x-api-key`, `content-type`, `accept`; upstream timeout 15 s → 504; upstream failure → 502; both JSON with CORS headers.
- Browser code stays ES2017-safe (no `?.`, `??`, modules).
- Never commit the user's API key or LAN address; use them only in the local test browser session.
- Never send a real `POST /request` to the user's Seerr during verification (it would create a real Radarr/Sonarr request): search and detail views only.

## Review Focus

1. Proxy must not be an open relay: non-`/api/v1/` paths, `..` traversal, non-HTTP(S) bases, and non-GET/POST methods are rejected without touching the upstream (Task 1).
2. Upstream non-2xx on POST (e.g. 409 "already requested") must pass through with the same status and body so the UI still says "Already requested." (Task 1).
3. Upstream down or hanging must yield a prompt JSON 502/504 *with CORS headers*; otherwise the browser reports an opaque CORS failure (Task 1) and the UI should say "Cannot reach Seerr" (Task 2).
4. Importing `service.js` in tests must not start a server; relaunching the module while the port is taken must not crash the service (Task 1).
5. On a desktop (no proxy running) startup must fall back to direct mode within about one probe, not a multi-second stall (Task 2, Task 3).

---

### Task 1: service.js proxy server

**Files:**
- Create: `service.js` (replaces the empty placeholder)
- Test: `test/service.test.js`

**Interfaces:**
- Produces: `module.exports = { createProxyServer(opts?: {timeoutMs?: number}) → http.Server (not listening), start() → http.Server (listening on 127.0.0.1:8765, swallows EADDRINUSE), PORT: 8765, HOST: '127.0.0.1' }`. Auto-calls `start()` on load unless `process.env.SR_NO_START` is set.
- HTTP contract: `GET /health` → `200 {"ok":true}`; `OPTIONS *` → `204` + CORS; `GET|POST /proxy/api/v1/<rest>` with header `X-Seerr-Url: <base>` → forwards to `<base><prefix>/api/v1/<rest>`; errors: 400 bad/missing `X-Seerr-Url`, 403 path not allowed, 404 unknown route, 405 method, 502 upstream error, 504 upstream timeout.

- [ ] **Step 1: Write the failing tests** — `test/service.test.js`
```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/service.test.js`
Expected: FAIL (the current `service.js` is empty, so `createProxyServer` is not a function).

- [ ] **Step 3: Implement** — `service.js`
```js
'use strict';
// Local CORS proxy for the Seerr Request TizenBrew module.
// TizenBrew runs this file in its Node service (possibly Node 4.4.3), so keep the
// syntax ES5-style, use only core modules, and keep everything in this one file.
var http = require('http');
var https = require('https');
var urlLib = require('url');

var PORT = 8765;
var HOST = '127.0.0.1';
var PREFIX = '/proxy/';
var FORWARD_HEADERS = ['x-api-key', 'content-type', 'accept'];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-seerr-url, x-api-key, content-type, accept');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseBase(value) {
  var s = String(value || '').trim().replace(/\/+$/, '');
  var u = urlLib.parse(s);
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || undefined,
    prefix: (u.pathname || '').replace(/\/+$/, '')
  };
}

function pathAllowed(pathOnly) {
  return pathOnly.indexOf('api/v1/') === 0 && !/(^|\/)\.\.(\/|$)/.test(pathOnly);
}

function createProxyServer(opts) {
  var timeoutMs = (opts && opts.timeoutMs) || 15000;

  return http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }
    if (req.url === '/health') return sendJson(res, 200, { ok: true });
    if (req.url.indexOf(PREFIX) !== 0) return sendJson(res, 404, { message: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { message: 'Method not allowed' });

    var rest = req.url.slice(PREFIX.length);
    if (!pathAllowed(rest.split('?')[0])) return sendJson(res, 403, { message: 'Only /api/v1 paths are proxied' });

    var base = parseBase(req.headers['x-seerr-url']);
    if (!base) return sendJson(res, 400, { message: 'Missing or invalid X-Seerr-Url header' });

    var headers = {};
    FORWARD_HEADERS.forEach(function (h) { if (req.headers[h]) headers[h] = req.headers[h]; });
    if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

    var timedOut = false;
    var lib = base.protocol === 'https:' ? https : http;
    var up = lib.request({
      hostname: base.hostname,
      port: base.port,
      path: base.prefix + '/' + rest,
      method: req.method,
      headers: headers
    }, function (ures) {
      setCors(res);
      var out = {};
      if (ures.headers['content-type']) out['Content-Type'] = ures.headers['content-type'];
      res.writeHead(ures.statusCode, out);
      ures.pipe(res);
    });

    up.setTimeout(timeoutMs, function () { timedOut = true; up.abort(); });
    up.on('error', function (e) {
      if (res.headersSent) return res.end();
      sendJson(res, timedOut ? 504 : 502, { message: timedOut ? 'Seerr timed out' : 'Cannot reach Seerr: ' + (e && e.code ? e.code : e) });
    });
    req.on('aborted', function () { up.abort(); });
    req.pipe(up);
  });
}

function start() {
  var server = createProxyServer();
  server.on('error', function (e) {
    console.log('Seerr proxy: ' + (e && e.code === 'EADDRINUSE' ? 'already running on ' + PORT : e));
  });
  server.listen(PORT, HOST, function () {
    console.log('Seerr proxy listening on ' + HOST + ':' + PORT);
  });
  return server;
}

module.exports = { createProxyServer: createProxyServer, start: start, PORT: PORT, HOST: HOST };

if (!(typeof process !== 'undefined' && process.env && process.env.SR_NO_START)) start();
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/service.test.js && npm test`
Expected: all `service.test.js` tests PASS, full suite green.

- [ ] **Step 5: Smoke the real entry point**

Run: `node service.js & sleep 1; curl -s http://127.0.0.1:8765/health; node service.js; kill %1`
Expected: prints `{"ok":true}`; the second `node service.js` logs `Seerr proxy: already running on 8765` and exits without a stack trace.

- [ ] **Step 6: Commit**
```bash
git add service.js test/service.test.js
git commit -m "feat: add local CORS proxy service for Seerr"
```

---

### Task 2: api.js proxy mode and startup probe

**Files:**
- Modify: `app/js/api.js` (`httpError`, `createClient`, new `probeProxy`, exports)
- Test: `test/api-proxy.test.js`

**Interfaces:**
- Consumes: the proxy HTTP contract from Task 1.
- Produces: `createClient({ baseUrl, apiKey, fetch?, timeoutMs?, proxyUrl? })` — with `proxyUrl` set, requests go to `<proxyUrl>/proxy/api/v1<path>` with header `X-Seerr-Url: <normalizeBase(baseUrl)>`; without it nothing changes. `probeProxy(proxyUrl, { fetch?, attempts?: 6, delayMs?: 500, timeoutMs?: 1500 }) → Promise<boolean>`. HTTP 502/504 map to `ApiError` kind `'network'` ("Cannot reach Seerr...").

- [ ] **Step 1: Write the failing tests** — `test/api-proxy.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, probeProxy } = require('../app/js/api.js');

function fakeFetch(handler) {
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return Promise.resolve(handler(url, init, calls.length)); };
  f.calls = calls;
  return f;
}
const ok = (body, status = 200) => ({ ok: true, status, json: () => Promise.resolve(body) });
const fail = (status) => ({ ok: false, status, json: () => Promise.resolve({}) });

test('proxyUrl routes calls through the proxy with X-Seerr-Url and the api key', async () => {
  const f = fakeFetch(() => ok({ id: 1 }));
  const c = createClient({ baseUrl: ' seerr.lan:5055/ ', apiKey: 'KEY', fetch: f, proxyUrl: 'http://127.0.0.1:8765/' });
  await c.getMe();
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8765/proxy/api/v1/auth/me');
  assert.equal(f.calls[0].init.headers['X-Seerr-Url'], 'http://seerr.lan:5055');
  assert.equal(f.calls[0].init.headers['X-Api-Key'], 'KEY');
});

test('proxy mode keeps search encoding and request bodies', async () => {
  const f = fakeFetch(() => ok({ results: [] }, 200));
  const c = createClient({ baseUrl: 'http://s:5055', apiKey: 'K', fetch: f, proxyUrl: 'http://127.0.0.1:8765' });
  const q = 'Amélie & Co #1';
  await c.search(q);
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8765/proxy/api/v1/search?query=' + encodeURIComponent(q) + '&page=1');
  await c.requestMedia('movie', 603);
  assert.equal(f.calls[1].url, 'http://127.0.0.1:8765/proxy/api/v1/request');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { mediaType: 'movie', mediaId: 603 });
});

test('without proxyUrl no X-Seerr-Url header is sent and the URL is direct', async () => {
  const f = fakeFetch(() => ok({}));
  await createClient({ baseUrl: 'http://s:5055', apiKey: 'K', fetch: f }).getMe();
  assert.equal(f.calls[0].url, 'http://s:5055/api/v1/auth/me');
  assert.equal(f.calls[0].init.headers['X-Seerr-Url'], undefined);
});

test('502 and 504 map to a network error (Seerr unreachable behind the proxy)', async () => {
  for (const status of [502, 504]) {
    const c = createClient({ baseUrl: 'http://s', apiKey: 'K', fetch: fakeFetch(() => fail(status)), proxyUrl: 'http://127.0.0.1:8765' });
    await assert.rejects(() => c.getMe(), (e) => e.kind === 'network' && /Cannot reach Seerr/.test(e.message) && e.status === status, String(status));
  }
});

test('proxied 409 still maps to conflict', async () => {
  const c = createClient({ baseUrl: 'http://s', apiKey: 'K', fetch: fakeFetch(() => fail(409)), proxyUrl: 'http://127.0.0.1:8765' });
  await assert.rejects(() => c.requestMedia('movie', 1), (e) => e.kind === 'conflict');
});

test('probeProxy true on first healthy answer', async () => {
  const f = fakeFetch(() => ok({ ok: true }));
  assert.equal(await probeProxy('http://127.0.0.1:8765/', { fetch: f, delayMs: 1 }), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8765/health');
});

test('probeProxy retries until the service is up', async () => {
  const f = fakeFetch((u, i, n) => (n < 3 ? Promise.reject(new TypeError('refused')) : ok({ ok: true })));
  assert.equal(await probeProxy('http://127.0.0.1:8765', { fetch: f, attempts: 6, delayMs: 1 }), true);
  assert.equal(f.calls.length, 3);
});

test('probeProxy gives up after the configured attempts', async () => {
  const f = fakeFetch(() => Promise.reject(new TypeError('refused')));
  assert.equal(await probeProxy('http://127.0.0.1:8765', { fetch: f, attempts: 3, delayMs: 1 }), false);
  assert.equal(f.calls.length, 3);
});

test('probeProxy with attempts:1 makes exactly one request (desktop fallback is fast)', async () => {
  const f = fakeFetch(() => Promise.reject(new TypeError('refused')));
  assert.equal(await probeProxy('http://127.0.0.1:8765', { fetch: f, attempts: 1, delayMs: 5000 }), false);
  assert.equal(f.calls.length, 1);
});

test('probeProxy rejects non-ok, wrong body, and hanging fetches', async () => {
  assert.equal(await probeProxy('http://x', { fetch: fakeFetch(() => fail(404)), attempts: 1 }), false);
  assert.equal(await probeProxy('http://x', { fetch: fakeFetch(() => ok({ ok: false })), attempts: 1 }), false);
  assert.equal(await probeProxy('http://x', { fetch: () => new Promise(() => {}), attempts: 1, timeoutMs: 20 }), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/api-proxy.test.js`
Expected: FAIL (`probeProxy is not a function`; proxy URL assertions fail).

- [ ] **Step 3: Implement** — edit `app/js/api.js`

(a) In `httpError`, add before the final `return`:
```js
    if (status === 502 || status === 504) return new ApiError('network', 'Cannot reach Seerr. Check the URL and network.', status);
```

(b) In `createClient`, replace the `base` line and the headers set-up:
```js
    var seerrBase = normalizeBase(cfg.baseUrl);
    var proxy = cfg.proxyUrl ? String(cfg.proxyUrl).replace(/\/+$/, '') : null;
    var base = proxy ? proxy + '/proxy/api/v1' : seerrBase + '/api/v1';
```
and right after `var init = {...};` add:
```js
      if (proxy) init.headers['X-Seerr-Url'] = seerrBase;
```

(c) Add `probeProxy` above the `return {` export block and export it:
```js
  function probeProxy(proxyUrl, opts) {
    opts = opts || {};
    var attempts = opts.attempts || 6;
    var delayMs = opts.delayMs === undefined ? 500 : opts.delayMs;
    var perTry = opts.timeoutMs || 1500;
    var doFetch = opts.fetch || function (u, o) { return fetch(u, o); };
    var url = String(proxyUrl).replace(/\/+$/, '') + '/health';

    function once() {
      var timer;
      var timeout = new Promise(function (resolve) { timer = setTimeout(function () { resolve(false); }, perTry); });
      var call = Promise.resolve().then(function () { return doFetch(url); }).then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (j) { return !!(j && j.ok === true); });
      }).catch(function () { return false; });
      return Promise.race([call, timeout]).then(function (v) { clearTimeout(timer); return v; });
    }

    function attempt(n) {
      return once().then(function (ok) {
        if (ok || n >= attempts) return ok;
        return new Promise(function (r) { setTimeout(r, delayMs); }).then(function () { return attempt(n + 1); });
      });
    }
    return attempt(1);
  }
```
Export block becomes:
```js
  return {
    STATUS: STATUS, ApiError: ApiError, normalizeBase: normalizeBase,
    createClient: createClient, probeProxy: probeProxy, statusLabel: statusLabel, canRequest: canRequest
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: all tests PASS (existing `api.test.js` unchanged and green).

- [ ] **Step 5: Commit**
```bash
git add app/js/api.js test/api-proxy.test.js
git commit -m "feat: route Seerr calls through the local proxy when available"
```

---

### Task 3: Wire proxy detection into the app, plus a no-CORS mock

**Files:**
- Modify: `app/js/app.js`, `app/js/view-setup.js`, `scripts/mock-seerr.js`
- Test: `test/wiring.test.js`

**Interfaces:**
- Consumes: `SR.api.probeProxy`, `SR.api.createClient({ proxyUrl })`.
- Produces: `ctx.proxyUrl: string|null`, `ctx.makeClient(cfg) → client`; mock env flag `MOCK_NO_CORS=1` (no CORS headers; `OPTIONS` → 405, like the real Seerr).

- [ ] **Step 1: Write the failing test** — `test/wiring.test.js` (keeps the page and service ports in sync, and bans direct client construction in views)
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('app.js proxy URL matches the service port', () => {
  const { PORT, HOST } = (process.env.SR_NO_START = '1', require('../service.js'));
  assert.ok(read('app/js/app.js').indexOf('http://' + HOST + ':' + PORT) !== -1);
});

test('views build clients through ctx.makeClient so proxy mode applies everywhere', () => {
  ['app/js/view-setup.js', 'app/js/view-search.js', 'app/js/view-detail.js'].forEach((f) => {
    assert.equal(/SR\.api\.createClient\(/.test(read(f)), false, f + ' must use ctx.makeClient');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/wiring.test.js`
Expected: FAIL (no `http://127.0.0.1:8765` in `app.js`; `view-setup.js` calls `SR.api.createClient(`).

- [ ] **Step 3: Implement**

`app/js/view-setup.js` — replace
```js
      SR.api.createClient({ baseUrl: url, apiKey: apiKey }).getMe().then(function () {
```
with
```js
      ctx.makeClient({ baseUrl: url, apiKey: apiKey }).getMe().then(function () {
```

`app/js/app.js` — replace the context block and boot sequence. Full new file:
```js
(function (w) {
  var SR = w.SR;
  var PROXY_URL = 'http://127.0.0.1:8765';
  var store = SR.store.createStore();
  var cfg = store.load();

  var ctx = {
    root: document.getElementById('app'),
    nav: SR.nav,
    store: store,
    cfg: cfg,
    proxyUrl: null,
    client: null,
    searchState: { text: '', items: [], focusIndex: -1 }
  };
  var views = { setup: SR.viewSetup, search: SR.viewSearch, detail: SR.viewDetail };
  var current = null;

  ctx.makeClient = function (c) {
    return SR.api.createClient({ baseUrl: c.baseUrl, apiKey: c.apiKey, proxyUrl: ctx.proxyUrl });
  };

  ctx.show = function (name, arg) {
    if (current) current.destroy();
    current = views[name](ctx, arg);
  };

  ctx.exit = function () {
    try { w.tizen.application.getCurrentApplication().exit(); } catch (e) { w.close(); }
  };

  ctx.onSaved = function (newCfg) {
    ctx.cfg = newCfg;
    ctx.client = ctx.makeClient(newCfg);
    store.save(newCfg);
    ctx.searchState = { text: '', items: [], focusIndex: -1 };
    ctx.show('search');
  };

  w.addEventListener('keydown', function (e) {
    // Back: Tizen 10009, Escape on desktop. Settings: red button (403), F2 on desktop.
    if (e.keyCode === 10009 || e.keyCode === 27) {
      e.preventDefault();
      if (current) current.onBack();
    } else if (e.keyCode === 403 || e.keyCode === 113) {
      e.preventDefault();
      if (current && current.name !== 'setup') ctx.show('setup');
    }
  });

  SR.nav.init();
  if (!store.isPersistent()) SR.toast('Settings cannot be saved on this device.', 'error');

  // On a TV the TizenBrew service may still be starting, so retry; on desktop probe once.
  var starting = SR.h('div', { 'class': 'message', text: 'Starting...' });
  ctx.root.appendChild(starting);
  SR.api.probeProxy(PROXY_URL, { attempts: w.tizen ? 8 : 1 }).then(function (ok) {
    ctx.proxyUrl = ok ? PROXY_URL : null;
    ctx.client = cfg ? ctx.makeClient(cfg) : null;
    SR.clear(ctx.root);
    ctx.show(cfg ? 'search' : 'setup');
  });
})(window);
```

`scripts/mock-seerr.js` — replace the three `setHeader` lines and the OPTIONS line with:
```js
  const NO_CORS = !!process.env.MOCK_NO_CORS; // behave like the real Seerr: no CORS headers, preflight 405
  if (!NO_CORS) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'x-api-key, content-type, accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return send(res, NO_CORS ? 405 : 204);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Verify in desktop Chrome — proxy needed, then proxy works**

Start `MOCK_NO_CORS=1 npm run mock`, `python3 -m http.server 8080`, and set `localStorage['seerr-request:config']` to `{"baseUrl":"http://localhost:5055","apiKey":"testkey"}` for `http://localhost:8080` (chrome-devtools MCP `evaluate_script`).
1. **Without the service:** open `http://localhost:8080/app/index.html`, search `matrix` using the keyboard. Expected: message "Cannot reach Seerr. Check the URL and network." (direct call blocked by CORS), startup took about one probe (no multi-second stall).
2. **With the service:** `node service.js &`, reload, search `matrix`. Expected: two results; `list_network_requests` shows calls to `127.0.0.1:8765/proxy/api/v1/search...`, none to `localhost:5055` directly.
3. Open a movie and a TV title (`breaking`) to confirm detail loads via the proxy; request `The Matrix` (mock, safe): toast "Requested: The Matrix", the mock logs the POST. Request `Breaking Bad`: toast "Already requested." (409 passthrough).
4. `kill %1` the service, reload: back to the "Cannot reach Seerr" behavior.

- [ ] **Step 6: Verify against the user's real Seerr (read-only)**

Using the Seerr URL and API key the user gave in chat (do not write them to any file), put them in `localStorage` as above, run `node service.js`, reload, and search `matrix`. Expected: real results with posters, and opening a title works. **Do not press Request.** Then clear that `localStorage` entry.

- [ ] **Step 7: Commit**
```bash
git add app scripts test/wiring.test.js
git commit -m "feat: detect and use the local proxy at startup; add no-CORS mock mode"
```

---

### Task 4: Docs, version, and publishing notes

**Files:**
- Modify: `README.md`, `package.json` (`version` → `0.2.0`, add `repository` placeholder is NOT allowed — leave it out)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md`**

Replace the "Install (TizenBrew)" section with:
```markdown
## Install (TizenBrew)

TizenBrew loads modules from jsDelivr, so the module must be public first:

1. Push this repo to a public GitHub repo and create a version tag, e.g. `git tag v0.2.0 && git push --tags`.
2. In TizenBrew add the module as `gh/<user>/<repo>` (or `gh/<user>/<repo>@v0.2.0` to pin the tag; jsDelivr caches branch refs for hours, a tag avoids stale files). An npm package works too: `npm/<package>`.
3. Launch **Seerr Request**. TizenBrew starts the module's service (`service.js`) automatically.

If the service crashed, TizenBrew's module settings show the service status and error.
```
and add a section:
```markdown
## How it talks to Seerr

Seerr sends no CORS headers, so a web page on the TV cannot call it directly. `service.js` runs on the TV as a tiny proxy on `127.0.0.1:8765` (loopback only, `/api/v1` paths only, GET/POST only). The page checks `http://127.0.0.1:8765/health` at startup and uses the proxy when it answers; otherwise it calls Seerr directly (desktop development, or a Seerr behind a reverse proxy that adds CORS headers). The API key is stored on the TV and sent only to your Seerr through the proxy. The proxy does not support self-signed HTTPS certificates.
```
Also update the troubleshooting bullet "Cannot reach Seerr" to mention: check that the module's service is running (TizenBrew module settings), and that the TV can reach the Seerr IP and port.

- [ ] **Step 2: Bump version** — in `package.json` set `"version": "0.2.0"`.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**
```bash
git add README.md package.json
git commit -m "docs: document the proxy service and jsDelivr install; bump to 0.2.0"
```

- [ ] **Step 5: Hand off publishing to the user** — do **not** push or tag. Tell the user the exact commands (create public repo, `git remote add`, `git push`, `git tag v0.2.0`, `git push --tags`) and that publishing to GitHub is theirs to run or to approve explicitly.

---

### Task 5: On-TV verification checklist (user)

**Files:** none.

- [ ] **Step 1: Give the user this checklist after publishing**
1. Add `gh/<user>/<repo>@v0.2.0` in TizenBrew and launch it. Expected: "Starting..." briefly, then the setup screen (first run).
2. Enter `http://192.168.1.10:5055` and the API key with the on-screen keyboard; Save. Expected: search screen (proves the proxy path).
3. Search a title, open it, request something harmless. Expected: toast "Requested", the item appears in Seerr and Radarr/Sonarr.
4. If setup shows "Cannot reach Seerr": open TizenBrew's service status for this module; report the error text. Likely causes: service crashed (syntax unsupported by the TV's Node), port 8765 in use, TV cannot reach the Seerr IP.
5. Report which of Back (exit/back), Red (settings), and poster loading work.
