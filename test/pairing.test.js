process.env.SR_NO_START = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const querystring = require('node:querystring');
const { createPairing, createProxyServer, SETUP_PORT } = require('../service.js');

function call(port, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path, headers: opts.headers || {}, agent: false }, (res) => {
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

const startP = (p) => new Promise((resolve, reject) => p.start((e, info) => (e ? reject(e) : resolve(info))));

function submit(port, fields) {
  const body = querystring.stringify(fields);
  return call(port, { method: 'POST', path: '/submit', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } });
}

function setup(t, opts) {
  const p = createPairing(Object.assign({ host: '127.0.0.1', port: 0 }, opts));
  t.after(() => p.cancel());
  return p;
}

const good = (pin) => ({ url: 'http://192.168.1.10:5055', key: 'abc/DEF+123==', pin });

test('constants', () => assert.equal(SETUP_PORT, 8766));

test('start returns a 4-digit pin, the port and phone addresses', async (t) => {
  const p = setup(t);
  const info = await startP(p);
  assert.match(info.pin, /^\d{4}$/);
  assert.ok(info.port > 0);
  assert.ok(Array.isArray(info.addresses));
  info.addresses.forEach((a) => assert.match(a, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/));
  assert.deepEqual(p.poll(), { status: 'waiting' });
});

test('start while active returns the same pin', async (t) => {
  const p = setup(t);
  const a = await startP(p);
  const b = await startP(p);
  assert.equal(a.pin, b.pin);
  assert.equal(a.port, b.port);
});

test('GET / serves the mobile form with url, key and pin fields', async (t) => {
  const p = setup(t);
  const { port } = await startP(p);
  const r = await call(port, { path: '/' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  ['name="url"', 'name="key"', 'name="pin"', 'method="post"'].forEach((s) => assert.ok(r.text.toLowerCase().indexOf(s) !== -1, s));
});

test('valid submit is returned by poll exactly once, then the server is closed', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  const r = await submit(port, good(pin));
  assert.equal(r.status, 200);
  assert.deepEqual(p.poll(), { status: 'done', baseUrl: 'http://192.168.1.10:5055', apiKey: 'abc/DEF+123==' });
  assert.deepEqual(p.poll(), { status: 'idle' });
  await assert.rejects(() => call(port, { path: '/' }));
});

test('whitespace around url and key is trimmed', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  await submit(port, { url: '  http://s:5055/ \n', key: '  KEY \n', pin });
  assert.deepEqual(p.poll(), { status: 'done', baseUrl: 'http://s:5055/', apiKey: 'KEY' });
});

test('wrong pin is a 403 and stores nothing', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  const wrong = pin === '0000' ? '1111' : '0000';
  const r = await submit(port, good(wrong));
  assert.equal(r.status, 403);
  assert.deepEqual(p.poll(), { status: 'waiting' });
});

test('five wrong pins close pairing; even the right pin afterwards is refused', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  const wrong = pin === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) assert.equal((await submit(port, good(wrong))).status, 403);
  assert.deepEqual(p.poll(), { status: 'idle' });
  await assert.rejects(() => submit(port, good(pin)));
});

test('invalid url, bad port, non-http scheme, or empty key are a 400 and store nothing', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  const bads = [
    { url: 'notaurl', key: 'K' }, { url: 'ftp://x', key: 'K' }, { url: 'http://127.0.0.1:99999', key: 'K' },
    { url: 'http://s:5055', key: '   ' }, { url: 'http://s:5055', key: '' }, { url: '', key: 'K' },
    { url: 'http://s:5055', key: 'k'.repeat(513) }
  ];
  for (const b of bads) assert.equal((await submit(port, Object.assign({ pin }, b))).status, 400, JSON.stringify(b).slice(0, 60));
  assert.deepEqual(p.poll(), { status: 'waiting' });
});

test('body over 8 KB is a 413 and stores nothing', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  const r = await submit(port, { url: 'http://s:5055', key: 'k'.repeat(9000), pin });
  assert.equal(r.status, 413);
  assert.deepEqual(p.poll(), { status: 'waiting' });
});

test('unknown paths on the pairing server are 404', async (t) => {
  const p = setup(t);
  const { port } = await startP(p);
  assert.equal((await call(port, { path: '/nope' })).status, 404);
  assert.equal((await call(port, { method: 'POST', path: '/' })).status, 404);
});

test('cancel closes the server and clears state', async (t) => {
  const p = setup(t);
  const { port, pin } = await startP(p);
  await submit(port, good(pin));
  p.cancel();
  assert.deepEqual(p.poll(), { status: 'idle' });
  await assert.rejects(() => call(port, { path: '/' }));
});

test('pairing expires after the timeout and forgets the config', async (t) => {
  const p = setup(t, { timeoutMs: 60 });
  const { port, pin } = await startP(p);
  await submit(port, good(pin));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(p.poll(), { status: 'idle' });
  await assert.rejects(() => call(port, { path: '/' }));
});

test('poll with nothing started is idle; a new start after done works', async (t) => {
  const p = setup(t);
  assert.deepEqual(p.poll(), { status: 'idle' });
  const a = await startP(p);
  await submit(a.port, good(a.pin));
  p.poll();
  const b = await startP(p);
  assert.deepEqual(p.poll(), { status: 'waiting' });
  assert.match(b.pin, /^\d{4}$/);
});

test('start reports an error when the port is taken', async (t) => {
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  t.after(() => blocker.close());
  const p = createPairing({ host: '127.0.0.1', port: blocker.address().port });
  const err = await startP(p).then(() => null, (e) => e);
  assert.ok(err);
  assert.equal(err.code, 'EADDRINUSE');
  assert.deepEqual(p.poll(), { status: 'idle' });
});

test('loopback API on the proxy: start, poll, cancel with CORS headers', async (t) => {
  const p = setup(t);
  const proxy = createProxyServer({ pairing: p });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  t.after(() => { if (proxy.closeAllConnections) proxy.closeAllConnections(); proxy.close(); });
  const pp = proxy.address().port;

  const s = await call(pp, { method: 'POST', path: '/setup/start' });
  assert.equal(s.status, 200);
  assert.equal(s.headers['access-control-allow-origin'], '*');
  const info = JSON.parse(s.text);
  assert.match(info.pin, /^\d{4}$/);

  assert.deepEqual(JSON.parse((await call(pp, { path: '/setup/poll' })).text), { status: 'waiting' });
  await submit(info.port, good(info.pin));
  const done = JSON.parse((await call(pp, { path: '/setup/poll' })).text);
  assert.deepEqual(done, { status: 'done', baseUrl: 'http://192.168.1.10:5055', apiKey: 'abc/DEF+123==' });
  assert.deepEqual(JSON.parse((await call(pp, { path: '/setup/poll' })).text), { status: 'idle' });

  const s2 = JSON.parse((await call(pp, { method: 'POST', path: '/setup/start' })).text);
  assert.equal((await call(pp, { method: 'POST', path: '/setup/cancel' })).status, 200);
  assert.deepEqual(JSON.parse((await call(pp, { path: '/setup/poll' })).text), { status: 'idle' });
  await assert.rejects(() => call(s2.port, { path: '/' }));
});

test('loopback start surfaces a port conflict as a JSON 500', async (t) => {
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  t.after(() => blocker.close());
  const p = createPairing({ host: '127.0.0.1', port: blocker.address().port });
  const proxy = createProxyServer({ pairing: p });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  t.after(() => { if (proxy.closeAllConnections) proxy.closeAllConnections(); proxy.close(); });
  const r = await call(proxy.address().port, { method: 'POST', path: '/setup/start' });
  assert.equal(r.status, 500);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(typeof JSON.parse(r.text).message, 'string');
});
