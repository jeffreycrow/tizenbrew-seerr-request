const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../app/js/store.js');

function fakeStorage(initial) {
  const d = Object.assign({}, initial);
  return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } };
}

test('save then load round-trips', () => {
  const s = createStore(fakeStorage());
  assert.equal(s.load(), null);
  s.save({ baseUrl: 'http://x:5055', apiKey: 'abc' });
  assert.deepEqual(s.load(), { baseUrl: 'http://x:5055', apiKey: 'abc' });
  assert.equal(s.isPersistent(), true);
});

test('corrupt or incomplete JSON loads as null', () => {
  assert.equal(createStore(fakeStorage({ 'seerr-request:config': '{nope' })).load(), null);
  assert.equal(createStore(fakeStorage({ 'seerr-request:config': '{"baseUrl":"x"}' })).load(), null);
});

test('null storage uses memory and reports not persistent', () => {
  const s = createStore(null);
  s.save({ baseUrl: 'http://a', apiKey: 'k' });
  assert.deepEqual(s.load(), { baseUrl: 'http://a', apiKey: 'k' });
  assert.equal(s.isPersistent(), false);
});

test('storage that throws on write falls back to memory', () => {
  const bad = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const s = createStore(bad);
  s.save({ baseUrl: 'http://a', apiKey: 'k' });
  assert.deepEqual(s.load(), { baseUrl: 'http://a', apiKey: 'k' });
  assert.equal(s.isPersistent(), false);
});

test('storage that throws on read loads as null', () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(createStore(bad).load(), null);
});

test('clear removes config', () => {
  const s = createStore(fakeStorage());
  s.save({ baseUrl: 'http://a', apiKey: 'k' });
  s.clear();
  assert.equal(s.load(), null);
});
