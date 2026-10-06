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

test('a 502/504 from the proxy shows its reason message, still as a network error', async () => {
  const withBody = (status, body) => ({ ok: false, status, json: () => Promise.resolve(body) });
  const msg = 'Seerr redirected to a different address (https://seerr.example.com). Use that URL instead.';
  const c = createClient({ baseUrl: 'http://s', apiKey: 'K', fetch: fakeFetch(() => withBody(502, { message: msg })), proxyUrl: 'http://127.0.0.1:8765' });
  await assert.rejects(() => c.getMe(), (e) => e.kind === 'network' && e.status === 502 && e.message === msg);
});

test('a 502 whose body is not JSON, or has no message, keeps the generic network message', async () => {
  const bad = { ok: false, status: 502, json: () => Promise.reject(new SyntaxError('x')) };
  const c1 = createClient({ baseUrl: 'http://s', apiKey: 'K', fetch: fakeFetch(() => bad), proxyUrl: 'http://127.0.0.1:8765' });
  await assert.rejects(() => c1.getMe(), (e) => e.kind === 'network' && /Cannot reach Seerr/.test(e.message));
  const c2 = createClient({ baseUrl: 'http://s', apiKey: 'K', fetch: fakeFetch(() => ({ ok: false, status: 504, json: () => Promise.resolve({}) })), proxyUrl: 'http://127.0.0.1:8765' });
  await assert.rejects(() => c2.getMe(), (e) => e.kind === 'network' && /Cannot reach Seerr/.test(e.message));
});

test('other statuses do not read the body for a message', async () => {
  const c = createClient({ baseUrl: 'http://s', apiKey: 'K', fetch: fakeFetch(() => ({ ok: false, status: 307, json: () => Promise.resolve({ message: 'nope' }) })) });
  await assert.rejects(() => c.getMe(), (e) => e.kind === 'http' && e.status === 307 && /307/.test(e.message));
});
