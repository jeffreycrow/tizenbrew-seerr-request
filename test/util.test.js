const test = require('node:test');
const assert = require('node:assert/strict');
const { debounce, latestOnly } = require('../app/js/util.js');

test('debounce fires once with last args after delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const d = debounce((x) => calls.push(x), 400);
  d('a'); d('b'); d('c');
  t.mock.timers.tick(399);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['c']);
});

test('debounce.cancel prevents the call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const d = debounce(() => calls.push(1), 100);
  d(); d.cancel();
  t.mock.timers.tick(200);
  assert.deepEqual(calls, []);
});

test('latestOnly: older token is stale after a newer one is issued', () => {
  const next = latestOnly();
  const first = next();
  assert.equal(first(), true);
  const second = next();
  assert.equal(first(), false);
  assert.equal(second(), true);
});
