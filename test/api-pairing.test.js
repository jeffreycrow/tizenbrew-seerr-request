const test = require('node:test');
const assert = require('node:assert/strict');
const { startPairing, pollPairing, cancelPairing, waitForPairing } = require('../app/js/api.js');

function fakeFetch(handler) {
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return Promise.resolve(handler(url, init, calls.length)); };
  f.calls = calls;
  return f;
}
const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status) => ({ ok: false, status, json: () => Promise.resolve({}) });
const P = 'http://127.0.0.1:8765';

test('startPairing POSTs /setup/start with no custom headers and returns the info', async () => {
  const f = fakeFetch(() => ok({ pin: '1234', port: 8766, addresses: ['http://192.168.1.50:8766'] }));
  const info = await startPairing(P + '/', { fetch: f });
  assert.equal(f.calls[0].url, P + '/setup/start');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers, undefined);
  assert.deepEqual(info, { pin: '1234', port: 8766, addresses: ['http://192.168.1.50:8766'] });
});

test('pollPairing GETs /setup/poll', async () => {
  const f = fakeFetch(() => ok({ status: 'waiting' }));
  assert.deepEqual(await pollPairing(P, { fetch: f }), { status: 'waiting' });
  assert.equal(f.calls[0].url, P + '/setup/poll');
  assert.equal(f.calls[0].init.method, 'GET');
});

test('cancelPairing POSTs /setup/cancel', async () => {
  const f = fakeFetch(() => ok({ ok: true }));
  await cancelPairing(P, { fetch: f });
  assert.equal(f.calls[0].url, P + '/setup/cancel');
  assert.equal(f.calls[0].init.method, 'POST');
});

test('pairing calls map non-2xx to http errors and fetch failures to network errors', async () => {
  await assert.rejects(() => startPairing(P, { fetch: fakeFetch(() => fail(500)) }), (e) => e.kind === 'http' && e.status === 500 && e.message.length > 0);
  await assert.rejects(() => startPairing(P, { fetch: () => Promise.reject(new TypeError('refused')) }), (e) => e.kind === 'network');
});

test('waitForPairing resolves the config once poll says done', async () => {
  const f = fakeFetch((u, i, n) => ok(n < 3 ? { status: 'waiting' } : { status: 'done', baseUrl: 'http://s:5055', apiKey: 'K' }));
  const cfg = await waitForPairing(P, { fetch: f, intervalMs: 1 });
  assert.deepEqual(cfg, { baseUrl: 'http://s:5055', apiKey: 'K' });
  assert.equal(f.calls.length, 3);
});

test('waitForPairing resolves null when the service reports idle (expired/cancelled)', async () => {
  const f = fakeFetch((u, i, n) => ok(n < 2 ? { status: 'waiting' } : { status: 'idle' }));
  assert.equal(await waitForPairing(P, { fetch: f, intervalMs: 1 }), null);
});

test('waitForPairing resolves null when shouldStop turns true, without further polls', async () => {
  let stop = false;
  const f = fakeFetch(() => { stop = true; return ok({ status: 'waiting' }); });
  assert.equal(await waitForPairing(P, { fetch: f, intervalMs: 1, shouldStop: () => stop }), null);
  assert.equal(f.calls.length, 1);
});

test('waitForPairing resolves null after the overall timeout', async () => {
  const f = fakeFetch(() => ok({ status: 'waiting' }));
  assert.equal(await waitForPairing(P, { fetch: f, intervalMs: 5, timeoutMs: 40 }), null);
});

test('waitForPairing retries after a transient poll failure', async () => {
  const f = fakeFetch((u, i, n) => (n === 1 ? Promise.reject(new TypeError('blip')) : ok({ status: 'done', baseUrl: 'http://s', apiKey: 'K' })));
  const cfg = await waitForPairing(P, { fetch: f, intervalMs: 1 });
  assert.deepEqual(cfg, { baseUrl: 'http://s', apiKey: 'K' });
  assert.equal(f.calls.length, 2);
});
