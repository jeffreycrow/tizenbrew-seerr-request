const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('app.js proxy URL matches the service port', () => {
  process.env.SR_NO_START = '1';
  const { PORT, HOST } = require('../service.js');
  assert.ok(read('app/js/app.js').indexOf('http://' + HOST + ':' + PORT) !== -1);
});

test('views build clients through ctx.makeClient so proxy mode applies everywhere', () => {
  ['app/js/view-setup.js', 'app/js/view-search.js', 'app/js/view-detail.js'].forEach((f) => {
    assert.equal(/SR\.api\.createClient\(/.test(read(f)), false, f + ' must use ctx.makeClient');
  });
});
