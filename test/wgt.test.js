const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createZip } = require('../scripts/zip.js');
const wgt = require('../scripts/build-wgt.js');

// minimal reader so the tests verify the archive independently of the writer
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(lho), 0x04034b50);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(data.length, usize, name);
    files[name] = { data, crc };
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const FIXED = new Date(2026, 0, 2, 3, 4, 6);
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wgt-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('createZip round-trips names and bytes, compressed and stored', () => {
  const big = Buffer.from('hello world '.repeat(500));
  const small = Buffer.from([1, 2, 3]);
  const files = readZip(createZip([{ name: 'a/b.txt', data: big }, { name: 'c.bin', data: small }, { name: 'empty.txt', data: Buffer.alloc(0) }], { date: FIXED }));
  assert.deepEqual(Object.keys(files), ['a/b.txt', 'c.bin', 'empty.txt']);
  assert.ok(files['a/b.txt'].data.equals(big));
  assert.ok(files['c.bin'].data.equals(small));
  assert.equal(files['empty.txt'].data.length, 0);
});

test('createZip crc32 matches the standard check value', () => {
  const files = readZip(createZip([{ name: 'x', data: Buffer.from('123456789') }], { date: FIXED }));
  assert.equal(files.x.crc, 0xCBF43926);
});

test('createZip handles utf-8 names and is deterministic for a fixed date', () => {
  const entries = [{ name: 'js/ü.txt', data: Buffer.from('é') }];
  const a = createZip(entries, { date: FIXED });
  const b = createZip(entries, { date: FIXED });
  assert.ok(a.equals(b));
  assert.deepEqual(Object.keys(readZip(a)), ['js/ü.txt']);
});

test('config.xml: valid Tizen TV widget with network access and the current version', () => {
  const xml = wgt.buildConfigXml({ version: '1.2.3' });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<widget [^>]*xmlns="http:\/\/www\.w3\.org\/ns\/widgets"/);
  assert.match(xml, /xmlns:tizen="http:\/\/tizen\.org\/ns\/widgets"/);
  assert.match(xml, /version="1\.2\.3"/);
  assert.match(xml, /<tizen:application id="([A-Za-z0-9]{10})\.([A-Za-z0-9]+)" package="\1" required_version="2\.3"\/>/);
  assert.match(xml, /<content src="index\.html"\/>/);
  assert.match(xml, /<icon src="icon\.png"\/>/);
  assert.match(xml, /<name>Seerr Request<\/name>/);
  assert.match(xml, /<tizen:profile name="tv"\/>/);
  assert.match(xml, /<tizen:privilege name="http:\/\/tizen\.org\/privilege\/internet"\/>/);
  assert.match(xml, /<access origin="\*" subdomains="true"\/>/);
  assert.match(xml, /hwkey-event="enable"/);
});

test('config.js always disables the proxy probe; bakes url and key only when given', () => {
  const none = wgt.buildConfigJs({});
  assert.match(none, /^window\.SR_CONFIG = /);
  const cfg0 = JSON.parse(none.replace(/^window\.SR_CONFIG = /, '').replace(/;\s*$/, ''));
  assert.deepEqual(cfg0, { proxy: false });
  const some = wgt.buildConfigJs({ baseUrl: 'http://192.168.1.10:5055', apiKey: 'abc/DEF+123==' });
  const cfg1 = JSON.parse(some.replace(/^window\.SR_CONFIG = /, '').replace(/;\s*$/, ''));
  assert.deepEqual(cfg1, { proxy: false, baseUrl: 'http://192.168.1.10:5055', apiKey: 'abc/DEF+123==' });
});

test('config.js escapes quotes, backslashes, newlines and </script> in values', () => {
  const nasty = 'k"ey\\\n</script><!--';
  const js = wgt.buildConfigJs({ baseUrl: 'http://s', apiKey: nasty });
  assert.equal(js.indexOf('</script>'), -1);
  assert.equal(js.indexOf('<!--'), -1);
  const cfg = JSON.parse(js.replace(/^window\.SR_CONFIG = /, '').replace(/;\s*$/, ''));
  assert.equal(cfg.apiKey, nasty);
});

test('index.html gets the config script right before app.js; missing anchor is an error', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const out = wgt.makeIndexHtml(html);
  assert.ok(out.indexOf('<script src="js/config.js"></script>') < out.indexOf('<script src="js/app.js"></script>'));
  assert.ok(out.indexOf('<script src="js/config.js"></script>') > out.indexOf('<script src="js/view-detail.js"></script>'));
  assert.throws(() => wgt.makeIndexHtml('<html></html>'), /app\.js/);
});

test('build without credentials: app files + config.xml + icon + empty config.js; no dev files', (t) => {
  const out = path.join(tmp(t), 'x.wgt');
  const r = wgt.build({ out, date: FIXED });
  assert.equal(r.baked, false);
  const files = readZip(fs.readFileSync(out));
  const names = Object.keys(files);
  ['config.xml', 'icon.png', 'index.html', 'css/app.css', 'js/app.js', 'js/api.js', 'js/vendor/norigin.js', 'js/config.js'].forEach((n) => assert.ok(names.indexOf(n) !== -1, n));
  names.forEach((n) => assert.ok(!/^(service\.js|test\/|docs\/|node_modules\/|scripts\/|package\.json|\.)/.test(n), 'unexpected ' + n));
  assert.ok(files['icon.png'].data.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.ok(files['index.html'].data.toString().indexOf('js/config.js') !== -1);
  assert.equal(files['js/config.js'].data.toString().indexOf('apiKey'), -1);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(files['config.xml'].data.toString().indexOf('version="' + pkg.version + '"') !== -1);
});

test('build with credentials normalizes the url and bakes both into config.js only', (t) => {
  const out = path.join(tmp(t), 'x.wgt');
  const r = wgt.build({ out, url: ' 192.168.1.10:5055/ ', key: ' KEY123== ', date: FIXED });
  assert.equal(r.baked, true);
  const files = readZip(fs.readFileSync(out));
  const cfg = JSON.parse(files['js/config.js'].data.toString().replace(/^window\.SR_CONFIG = /, '').replace(/;\s*$/, ''));
  assert.deepEqual(cfg, { proxy: false, baseUrl: 'http://192.168.1.10:5055', apiKey: 'KEY123==' });
  Object.keys(files).filter((n) => n !== 'js/config.js').forEach((n) => assert.equal(files[n].data.indexOf('KEY123=='), -1, n));
});

test('build rejects a url without a key (and the reverse)', (t) => {
  const out = path.join(tmp(t), 'x.wgt');
  assert.throws(() => wgt.build({ out, url: 'http://s:5055' }), /both/i);
  assert.throws(() => wgt.build({ out, key: 'K' }), /both/i);
});

test('parseArgs reads flags and falls back to environment variables', () => {
  assert.deepEqual(wgt.parseArgs(['--url', 'u', '--key', 'k', '--out', 'o.wgt'], {}), { url: 'u', key: 'k', out: 'o.wgt' });
  assert.deepEqual(wgt.parseArgs([], { SEERR_URL: 'eu', SEERR_API_KEY: 'ek' }), { url: 'eu', key: 'ek', out: undefined });
  assert.deepEqual(wgt.parseArgs(['--url=u2', '--key=k2'], {}), { url: 'u2', key: 'k2', out: undefined });
  assert.throws(() => wgt.parseArgs(['--bogus'], {}), /unknown/i);
});
