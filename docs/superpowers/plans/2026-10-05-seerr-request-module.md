# Seerr Request TizenBrew Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TizenBrew app module where the user searches Seerr with a Netflix-style square on-screen keyboard and requests movies/TV from a Samsung TV remote.

**Architecture:** Vanilla-JS single-page app (no build step for the module itself) loaded by TizenBrew as `packageType: "app"`. Pure-logic files (store, util, keyboard model, seasons, api) are UMD so they run in the browser (`window.SR.*`) and in Node tests. UI files are browser-only and sit on a thin `nav.js` wrapper over a vendored Norigin Spatial Navigation core. Networking is direct `fetch` to Seerr with `X-Api-Key`; a Node proxy is only a contingency (not in this plan).

**Tech Stack:** ES2017-level JavaScript (no `?.`, `??`, modules, or `aspect-ratio`), Node 20 `node:test`, Norigin spatial-navigation-core 4.1.2 (vendored via esbuild, dev-time only).

**Spec:** `docs/superpowers/specs/2026-10-05-seerr-request-module-design.md`

## Global Constraints

- `package.json`: `packageType: "app"`, `appName: "Seerr Request"`, `appPath: "app/index.html"`, `keys` array, `evaluateScriptOnDocumentStart: false`, `serviceFile` set (docs list it for app modules).
- No build step for module code; only `app/js/vendor/norigin.js` is generated (committed), via `npm run vendor`.
- Browser JS must avoid syntax newer than ES2017 and CSS newer than flexbox/grid (no `aspect-ratio`, no `gap` on flex-only reliance beyond grid gap).
- Auth: `X-Api-Key` header on every Seerr call; base path `/api/v1`.
- Keyboard: square tiles, 6 columns, rows `abcdef / ghijkl / mnopqr / stuvwx / yz1234 / 567890`, then an action row (space, delete, clear, shift, symbols toggle); symbols layer contains `: / . - _ @ ? # & = % + ~ ! , ; ( ) ' " [ ] * $`.
- Config (`baseUrl`, `apiKey`) in `localStorage` key `seerr-request:config`, every access wrapped in try/catch with in-memory fallback.
- Fetch timeout 10 s. Search debounce 400 ms.
- Out of scope: 4K requests, per-user login, request management, discovery pages.

## Review Focus

1. Search text with spaces/`&`/`#`/accents (e.g. `Amélie & Co #1`) must be URL-encoded correctly (Task 6).
2. Empty/whitespace-only query must make no network call and show no results (Task 6, Task 9).
3. Seerr URL typed with no scheme, trailing slash(es), surrounding whitespace, or a pasted `/api/v1` suffix must still work (Task 6).
4. A slow earlier search response must never overwrite a newer one (Task 2 `latestOnly`, used in Task 9).
5. TV title with only a "specials" season, or the user deselecting every season, must disable Request rather than send an empty request (Task 5, Task 10).

Also pinned: `localStorage` throwing/corrupt (Task 3), missing poster/`mediaInfo` (Task 6), 401/403/409/network/timeout/non-JSON responses (Task 6).

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`, `service.js`, `.gitignore`, `test/smoke.test.js`

**Interfaces:**
- Produces: `npm test` runs `node --test test/`; `npm run vendor` (defined in Task 7); `npm run mock` (defined in Task 8).

- [ ] **Step 1: Init git and create files**

```bash
cd /Users/jeffcrow/frame-request && git init
```

`package.json`:
```json
{
  "name": "tizenbrew-seerr-request",
  "version": "0.1.0",
  "description": "Search Seerr and request movies/TV from a Samsung TV (TizenBrew module).",
  "packageType": "app",
  "appName": "Seerr Request",
  "appPath": "app/index.html",
  "serviceFile": "service.js",
  "keys": ["ColorF0Red"],
  "evaluateScriptOnDocumentStart": false,
  "files": ["app", "service.js"],
  "license": "MIT",
  "scripts": {
    "test": "node --test test/",
    "vendor": "esbuild node_modules/@noriginmedia/norigin-spatial-navigation-core/dist/index.mjs --bundle --minify --format=iife --global-name=NoriginNav --target=es2017 --outfile=app/js/vendor/norigin.js",
    "mock": "node scripts/mock-seerr.js"
  },
  "devDependencies": {
    "@noriginmedia/norigin-spatial-navigation-core": "4.1.2",
    "esbuild": "^0.25.0"
  }
}
```

`service.js`:
```js
// Reserved for an optional CORS proxy (only built if direct fetch to Seerr is blocked).
// Intentionally empty: TizenBrew app modules list a serviceFile.
```

`.gitignore`:
```
node_modules/
.DS_Store
```

`test/smoke.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
test('runner works', () => assert.equal(1 + 1, 2));
```

- [ ] **Step 2: Install and run**

Run: `npm install && npm test`
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json service.js .gitignore test docs
git commit -m "chore: scaffold TizenBrew Seerr module"
```

---

### Task 2: util.js (debounce, latestOnly)

**Files:**
- Create: `app/js/util.js`
- Test: `test/util.test.js`

**Interfaces:**
- Produces: `SR.util.debounce(fn, ms)` → function with `.cancel()`; `SR.util.latestOnly()` → function `next()`; `next()` returns `isCurrent()` which is `true` only until `next()` is called again.

- [ ] **Step 1: Write the failing test** — `test/util.test.js`
```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, `Cannot find module '../app/js/util.js'`.

- [ ] **Step 3: Implement** — `app/js/util.js`
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).util = factory(); }
})(this, function () {
  function debounce(fn, ms) {
    var timer;
    function debounced() {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    }
    debounced.cancel = function () { clearTimeout(timer); };
    return debounced;
  }

  function latestOnly() {
    var n = 0;
    return function next() {
      var id = ++n;
      return function isCurrent() { return id === n; };
    };
  }

  return { debounce: debounce, latestOnly: latestOnly };
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git add app/js/util.js test/util.test.js && git commit -m "feat: add debounce and latestOnly helpers"
```

---

### Task 3: store.js (config persistence)

**Files:**
- Create: `app/js/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Produces: `SR.store.createStore(storage?)` → `{ load(): {baseUrl, apiKey}|null, save({baseUrl, apiKey}), clear(), isPersistent(): boolean }`. Passing `null` forces in-memory; omitting uses `window.localStorage` if usable.

- [ ] **Step 1: Write the failing test** — `test/store.test.js`
```js
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
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Implement** — `app/js/store.js`
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).store = factory(); }
})(this, function () {
  var KEY = 'seerr-request:config';

  function defaultStorage() {
    try {
      var s = window.localStorage;
      s.setItem('__sr_t', '1');
      s.removeItem('__sr_t');
      return s;
    } catch (e) { return null; }
  }

  function memoryStorage() {
    var d = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
      setItem: function (k, v) { d[k] = String(v); },
      removeItem: function (k) { delete d[k]; }
    };
  }

  function createStore(storage) {
    var mem = memoryStorage();
    var backing = storage === undefined ? defaultStorage() : storage;
    var persistent = !!backing;

    function target() { return backing || mem; }

    return {
      isPersistent: function () { return persistent; },
      load: function () {
        try {
          var raw = target().getItem(KEY);
          if (!raw) return null;
          var c = JSON.parse(raw);
          if (c && c.baseUrl && c.apiKey) return { baseUrl: String(c.baseUrl), apiKey: String(c.apiKey) };
          return null;
        } catch (e) { return null; }
      },
      save: function (cfg) {
        var json = JSON.stringify({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
        try { target().setItem(KEY, json); }
        catch (e) { backing = null; persistent = false; mem.setItem(KEY, json); }
      },
      clear: function () {
        try { target().removeItem(KEY); } catch (e) { /* ignore */ }
        mem.removeItem(KEY);
      }
    };
  }

  return { createStore: createStore };
});
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all PASS.

- [ ] **Step 5: Commit**
```bash
git add app/js/store.js test/store.test.js && git commit -m "feat: add config store with storage fallback"
```

---

### Task 4: keyboard.js (layout + state model)

**Files:**
- Create: `app/js/keyboard.js`
- Test: `test/keyboard.test.js`

**Interfaces:**
- Produces: `SR.keyboard.createKeyboard({ text?: string, onChange?: (text) => void })` →
  `{ getText(), setText(t) /* no onChange */, getLayer(): 'letters'|'symbols', isShift(): boolean, layout(): Row[], press(key): boolean }`
  where `Row = Key[]`, `Key = { id: 'r<row>c<col>', action: 'char'|'space'|'delete'|'clear'|'shift'|'layer', value?: string, display: string, span: number }`.
  `press(key)` returns `true` when the layout (labels/layer) changed and the UI must re-render. `onChange` fires only when text changes via `press`.

- [ ] **Step 1: Write the failing test** — `test/keyboard.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeyboard } = require('../app/js/keyboard.js');

const find = (kb, pred) => kb.layout().flat().find(pred);
const ch = (kb, c) => find(kb, (k) => k.action === 'char' && k.display.toLowerCase() === c);
const act = (kb, a) => find(kb, (k) => k.action === a);

test('letters layout: 6 letter/digit rows of 6 + action row; every row spans 6', () => {
  const kb = createKeyboard();
  const rows = kb.layout();
  assert.equal(rows.length, 7);
  rows.forEach((r) => assert.equal(r.reduce((n, k) => n + k.span, 0), 6));
  assert.equal(rows[0].map((k) => k.display).join(''), 'abcdef');
  assert.equal(rows[4].map((k) => k.display).join(''), 'yz1234');
  assert.equal(rows[5].map((k) => k.display).join(''), '567890');
});

test('key ids are unique', () => {
  const ids = createKeyboard().layout().flat().map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('typing chars, space, delete, clear; onChange fires with text', () => {
  const seen = [];
  const kb = createKeyboard({ onChange: (t) => seen.push(t) });
  kb.press(ch(kb, 'h')); kb.press(ch(kb, 'i'));
  kb.press(act(kb, 'space')); kb.press(ch(kb, '5'));
  assert.equal(kb.getText(), 'hi 5');
  kb.press(act(kb, 'delete'));
  assert.equal(kb.getText(), 'hi ');
  kb.press(act(kb, 'clear'));
  assert.equal(kb.getText(), '');
  assert.deepEqual(seen, ['h', 'hi', 'hi ', 'hi 5', 'hi ', '']);
});

test('delete on empty text is a no-op and does not fire onChange', () => {
  let n = 0;
  const kb = createKeyboard({ onChange: () => n++ });
  kb.press(act(kb, 'delete'));
  assert.equal(kb.getText(), '');
  assert.equal(n, 0);
});

test('shift is one-shot: uppercases next char, relayouts, then resets', () => {
  const kb = createKeyboard();
  assert.equal(kb.press(act(kb, 'shift')), true);
  assert.equal(kb.isShift(), true);
  assert.equal(ch(kb, 'a').display, 'A');
  assert.equal(kb.press(ch(kb, 'a')), true); // labels change back
  assert.equal(kb.getText(), 'A');
  assert.equal(kb.isShift(), false);
  assert.equal(kb.press(ch(kb, 'b')), false);
  assert.equal(kb.getText(), 'Ab');
});

test('symbols layer: toggle, URL chars available, no shift key, toggle back', () => {
  const kb = createKeyboard();
  assert.equal(kb.press(act(kb, 'layer')), true);
  assert.equal(kb.getLayer(), 'symbols');
  assert.equal(act(kb, 'shift'), undefined);
  'http'.split('').forEach(() => {});
  [':', '/', '.', '-', '_', '@', '+', '='].forEach((c) => assert.ok(find(kb, (k) => k.action === 'char' && k.display === c), c));
  kb.press(find(kb, (k) => k.display === ':'));
  assert.equal(kb.getText(), ':');
  kb.press(act(kb, 'layer'));
  assert.equal(kb.getLayer(), 'letters');
});

test('layer toggle clears pending shift', () => {
  const kb = createKeyboard();
  kb.press(act(kb, 'shift'));
  kb.press(act(kb, 'layer'));
  kb.press(act(kb, 'layer'));
  assert.equal(kb.isShift(), false);
});

test('setText replaces text without firing onChange', () => {
  let n = 0;
  const kb = createKeyboard({ text: 'x', onChange: () => n++ });
  assert.equal(kb.getText(), 'x');
  kb.setText('http://');
  assert.equal(kb.getText(), 'http://');
  assert.equal(n, 0);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Implement** — `app/js/keyboard.js`
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).keyboard = factory(); }
})(this, function () {
  var LETTER_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
  var SYMBOL_ROWS = [':/.-_@', '?#&=%+', '~!,;()', '\'"[]*$'];

  function actionRow(layer) {
    var row = [
      { action: 'space', display: 'SPACE', span: 2 },
      { action: 'delete', display: 'DEL', span: 1 },
      { action: 'clear', display: 'CLR', span: 1 }
    ];
    if (layer === 'letters') {
      row.push({ action: 'shift', display: 'Aa', span: 1 });
      row.push({ action: 'layer', display: '#+=', span: 1 });
    } else {
      row.push({ action: 'layer', display: 'ABC', span: 2 });
    }
    return row;
  }

  function createKeyboard(opts) {
    opts = opts || {};
    var text = opts.text || '';
    var layer = 'letters';
    var shift = false;

    function setTextAndNotify(t) {
      if (t === text) return;
      text = t;
      if (opts.onChange) opts.onChange(text);
    }

    function layout() {
      var charRows = (layer === 'letters' ? LETTER_ROWS : SYMBOL_ROWS).map(function (str) {
        return str.split('').map(function (c) {
          return { action: 'char', value: c, display: (layer === 'letters' && shift) ? c.toUpperCase() : c, span: 1 };
        });
      });
      var rows = charRows.concat([actionRow(layer)]);
      return rows.map(function (row, r) {
        var col = 0;
        return row.map(function (k) {
          var key = { id: 'r' + r + 'c' + col, action: k.action, display: k.display, span: k.span };
          if (k.value !== undefined) key.value = k.value;
          col += k.span;
          return key;
        });
      });
    }

    function press(key) {
      switch (key.action) {
        case 'char': {
          var wasShift = shift;
          var c = (layer === 'letters' && shift) ? key.value.toUpperCase() : key.value;
          shift = false;
          setTextAndNotify(text + c);
          return wasShift;
        }
        case 'space': setTextAndNotify(text + ' '); return false;
        case 'delete': setTextAndNotify(text.slice(0, -1)); return false;
        case 'clear': setTextAndNotify(''); return false;
        case 'shift': shift = !shift; return true;
        case 'layer': layer = layer === 'letters' ? 'symbols' : 'letters'; shift = false; return true;
        default: return false;
      }
    }

    return {
      getText: function () { return text; },
      setText: function (t) { text = t || ''; },
      getLayer: function () { return layer; },
      isShift: function () { return shift; },
      layout: layout,
      press: press
    };
  }

  return { createKeyboard: createKeyboard };
});
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all PASS.

- [ ] **Step 5: Commit**
```bash
git add app/js/keyboard.js test/keyboard.test.js && git commit -m "feat: add square on-screen keyboard model"
```

---

### Task 5: seasons.js (TV season selection)

**Files:**
- Create: `app/js/seasons.js`
- Test: `test/seasons.test.js`

**Interfaces:**
- Produces: `SR.seasons.createSelection(numbers: number[])` → `{ toggle(n), toggleAll(), isSelected(n): boolean, allSelected(): boolean, selected(): number[] /* sorted */, count(): number }`. Starts with every season selected. `toggleAll()` selects all if not all selected, otherwise selects none. Unknown `n` in `toggle` is ignored.

- [ ] **Step 1: Write the failing test** — `test/seasons.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSelection } = require('../app/js/seasons.js');

test('starts with all selected, sorted', () => {
  const s = createSelection([3, 1, 2]);
  assert.deepEqual(s.selected(), [1, 2, 3]);
  assert.equal(s.allSelected(), true);
  assert.equal(s.count(), 3);
});

test('toggle deselects and reselects; unknown numbers ignored', () => {
  const s = createSelection([1, 2]);
  s.toggle(1);
  assert.deepEqual(s.selected(), [2]);
  assert.equal(s.isSelected(1), false);
  assert.equal(s.allSelected(), false);
  s.toggle(99);
  assert.deepEqual(s.selected(), [2]);
  s.toggle(1);
  assert.equal(s.allSelected(), true);
});

test('toggleAll: all -> none -> all', () => {
  const s = createSelection([1, 2]);
  s.toggleAll();
  assert.equal(s.count(), 0);
  s.toggleAll();
  assert.deepEqual(s.selected(), [1, 2]);
});

test('no seasons (specials only): count 0, allSelected false', () => {
  const s = createSelection([]);
  assert.equal(s.count(), 0);
  assert.equal(s.allSelected(), false);
  s.toggleAll();
  assert.equal(s.count(), 0);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Implement** — `app/js/seasons.js`
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).seasons = factory(); }
})(this, function () {
  function createSelection(numbers) {
    var all = numbers.slice().sort(function (a, b) { return a - b; });
    var on = {};
    all.forEach(function (n) { on[n] = true; });

    function selected() { return all.filter(function (n) { return on[n]; }); }
    function allSelected() { return all.length > 0 && selected().length === all.length; }

    return {
      toggle: function (n) { if (all.indexOf(n) !== -1) on[n] = !on[n]; },
      toggleAll: function () {
        var target = !allSelected();
        all.forEach(function (n) { on[n] = target; });
      },
      isSelected: function (n) { return !!on[n]; },
      allSelected: allSelected,
      selected: selected,
      count: function () { return selected().length; }
    };
  }
  return { createSelection: createSelection };
});
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all PASS.

- [ ] **Step 5: Commit**
```bash
git add app/js/seasons.js test/seasons.test.js && git commit -m "feat: add season selection model"
```

---

### Task 6: api.js (Seerr client)

**Files:**
- Create: `app/js/api.js`
- Test: `test/api.test.js`

**Interfaces:**
- Produces (`SR.api`):
  - `normalizeBase(url: string): string` — trims, adds `http://` if no scheme, strips trailing `/` and a trailing `/api/v1`.
  - `createClient({ baseUrl, apiKey, fetch?, timeoutMs? })` → `{ getMe(), search(query, page?), getDetail(mediaType, id), requestMedia(mediaType, id, seasons?) }`, all return Promises; rejections are `ApiError`.
  - `ApiError` has `.kind` ∈ `'network'|'timeout'|'auth'|'notfound'|'conflict'|'parse'|'http'`, `.status`, `.message` (user-readable).
  - Item shape: `{ id, mediaType: 'movie'|'tv', title, year: string, posterUrl: string|null, overview: string, rating: number, status: number }`; `getDetail('tv', id)` adds `seasons: [{ number, name, episodeCount }]` excluding season 0.
  - `STATUS = { UNKNOWN:1, PENDING:2, PROCESSING:3, PARTIAL:4, AVAILABLE:5 }`, `statusLabel(code): string` (`''` when nothing to show), `canRequest(code): boolean` (false for 2, 3, 5).

- [ ] **Step 1: Write the failing test** — `test/api.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, normalizeBase, statusLabel, canRequest, STATUS } = require('../app/js/api.js');

function fakeFetch(handler) {
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return Promise.resolve(handler(url, init)); };
  f.calls = calls;
  return f;
}
const ok = (body, status = 200) => ({ ok: true, status, json: () => Promise.resolve(body) });
const fail = (status) => ({ ok: false, status, json: () => Promise.resolve({}) });
const client = (f, extra) => createClient(Object.assign({ baseUrl: 'http://seerr:5055', apiKey: 'KEY', fetch: f }, extra));

test('normalizeBase handles scheme, whitespace, slashes, /api/v1 suffix', () => {
  assert.equal(normalizeBase('  seerr.lan:5055/ '), 'http://seerr.lan:5055');
  assert.equal(normalizeBase('https://s.example.com///'), 'https://s.example.com');
  assert.equal(normalizeBase('http://s:5055/api/v1/'), 'http://s:5055');
  assert.equal(normalizeBase('HTTP://s:5055'), 'HTTP://s:5055');
});

test('every request sends X-Api-Key and targets /api/v1', async () => {
  const f = fakeFetch(() => ok({ id: 1 }));
  await client(f).getMe();
  assert.equal(f.calls[0].url, 'http://seerr:5055/api/v1/auth/me');
  assert.equal(f.calls[0].init.headers['X-Api-Key'], 'KEY');
  assert.equal(f.calls[0].init.method, 'GET');
});

test('api key is trimmed', async () => {
  const f = fakeFetch(() => ok({}));
  await createClient({ baseUrl: 'http://s', apiKey: '  KEY \n', fetch: f }).getMe();
  assert.equal(f.calls[0].init.headers['X-Api-Key'], 'KEY');
});

test('search encodes special characters', async () => {
  const f = fakeFetch(() => ok({ results: [] }));
  const q = 'Amélie & Co #1';
  await client(f).search(q);
  assert.equal(f.calls[0].url, 'http://seerr:5055/api/v1/search?query=' + encodeURIComponent(q) + '&page=1');
});

test('search with empty or whitespace query makes no request', async () => {
  const f = fakeFetch(() => ok({ results: [] }));
  assert.deepEqual(await client(f).search('   '), []);
  assert.deepEqual(await client(f).search(''), []);
  assert.equal(f.calls.length, 0);
});

test('search drops people and maps fields', async () => {
  const f = fakeFetch(() => ok({ results: [
    { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-31', posterPath: '/m.jpg', overview: 'o', voteAverage: 8.2, mediaInfo: { status: 5 } },
    { id: 1396, mediaType: 'tv', name: 'Breaking Bad', firstAirDate: '2008-01-20', posterPath: null, overview: '', voteAverage: 8.9 },
    { id: 7, mediaType: 'person', name: 'Keanu' }
  ] }));
  const items = await client(f).search('x');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { id: 603, mediaType: 'movie', title: 'The Matrix', year: '1999', posterUrl: 'https://image.tmdb.org/t/p/w342/m.jpg', overview: 'o', rating: 8.2, status: 5 });
  assert.equal(items[1].title, 'Breaking Bad');
  assert.equal(items[1].year, '2008');
  assert.equal(items[1].posterUrl, null);
  assert.equal(items[1].status, 0);
});

test('search tolerates missing dates and results', async () => {
  const f = fakeFetch(() => ok({ results: [{ id: 1, mediaType: 'movie', title: 'No Date' }] }));
  const [item] = await client(f).search('x');
  assert.equal(item.year, '');
  assert.equal(item.rating, 0);
  assert.deepEqual(await client(fakeFetch(() => ok({}))).search('x'), []);
});

test('getDetail tv excludes season 0 and normalizes seasons', async () => {
  const f = fakeFetch(() => ok({ id: 1396, name: 'Breaking Bad', firstAirDate: '2008-01-20', overview: 'ov', voteAverage: 8.9,
    seasons: [{ seasonNumber: 0, name: 'Specials', episodeCount: 3 }, { seasonNumber: 1, name: 'Season 1', episodeCount: 7 }, { seasonNumber: 2, episodeCount: 13 }],
    mediaInfo: { status: 2 } }));
  const d = await client(f).getDetail('tv', 1396);
  assert.equal(f.calls[0].url, 'http://seerr:5055/api/v1/tv/1396');
  assert.equal(d.mediaType, 'tv');
  assert.equal(d.status, 2);
  assert.deepEqual(d.seasons, [{ number: 1, name: 'Season 1', episodeCount: 7 }, { number: 2, name: 'Season 2', episodeCount: 13 }]);
});

test('getDetail rejects unknown media types without a request', async () => {
  const f = fakeFetch(() => ok({}));
  await assert.rejects(() => client(f).getDetail('person', 1));
  assert.equal(f.calls.length, 0);
});

test('requestMedia movie body', async () => {
  const f = fakeFetch(() => ok({ id: 9 }, 201));
  await client(f).requestMedia('movie', 603);
  const c = f.calls[0];
  assert.equal(c.url, 'http://seerr:5055/api/v1/request');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(c.init.body), { mediaType: 'movie', mediaId: 603 });
});

test('requestMedia tv body carries seasons', async () => {
  const f = fakeFetch(() => ok({}, 201));
  await client(f).requestMedia('tv', 1396, [1, 2]);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { mediaType: 'tv', mediaId: 1396, seasons: [1, 2] });
});

test('requestMedia tv with no seasons array is rejected without a request', async () => {
  const f = fakeFetch(() => ok({}));
  await assert.rejects(() => client(f).requestMedia('tv', 1, []));
  await assert.rejects(() => client(f).requestMedia('tv', 1));
  assert.equal(f.calls.length, 0);
});

test('http errors map to kinds', async () => {
  const kinds = { 401: 'auth', 403: 'auth', 404: 'notfound', 409: 'conflict', 500: 'http' };
  for (const [status, kind] of Object.entries(kinds)) {
    await assert.rejects(() => client(fakeFetch(() => fail(Number(status)))).getMe(), (e) => e.kind === kind && e.status === Number(status) && e.message.length > 0, status);
  }
});

test('fetch rejection maps to network error', async () => {
  const f = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(() => client(f).getMe(), (e) => e.kind === 'network');
});

test('non-JSON body maps to parse error', async () => {
  const f = fakeFetch(() => ({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('x')) }));
  await assert.rejects(() => client(f).getMe(), (e) => e.kind === 'parse');
});

test('timeout maps to timeout error', async () => {
  const f = () => new Promise(() => {});
  await assert.rejects(() => client(f, { timeoutMs: 20 }).getMe(), (e) => e.kind === 'timeout');
});

test('statusLabel and canRequest', () => {
  assert.equal(statusLabel(STATUS.PENDING), 'Requested');
  assert.equal(statusLabel(STATUS.PROCESSING), 'Processing');
  assert.equal(statusLabel(STATUS.PARTIAL), 'Partially available');
  assert.equal(statusLabel(STATUS.AVAILABLE), 'Available');
  assert.equal(statusLabel(0), '');
  assert.equal(statusLabel(1), '');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(canRequest), [true, true, false, false, true, false]);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Implement** — `app/js/api.js`
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.SR = root.SR || {}).api = factory(); }
})(this, function () {
  var STATUS = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 };
  var IMG = 'https://image.tmdb.org/t/p/w342';

  function ApiError(kind, message, status) {
    this.name = 'ApiError';
    this.kind = kind;
    this.message = message;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function httpError(status) {
    if (status === 401 || status === 403) return new ApiError('auth', 'Seerr rejected the API key.', status);
    if (status === 404) return new ApiError('notfound', 'Not found on Seerr.', status);
    if (status === 409) return new ApiError('conflict', 'Already requested.', status);
    return new ApiError('http', 'Seerr returned an error (' + status + ').', status);
  }

  function normalizeBase(url) {
    var u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/api\/v1$/, '');
    return u.replace(/\/+$/, '');
  }

  function statusLabel(code) {
    if (code === STATUS.PENDING) return 'Requested';
    if (code === STATUS.PROCESSING) return 'Processing';
    if (code === STATUS.PARTIAL) return 'Partially available';
    if (code === STATUS.AVAILABLE) return 'Available';
    return '';
  }

  function canRequest(code) {
    return code !== STATUS.PENDING && code !== STATUS.PROCESSING && code !== STATUS.AVAILABLE;
  }

  function toItem(r) {
    var date = r.releaseDate || r.firstAirDate || '';
    return {
      id: r.id,
      mediaType: r.mediaType,
      title: r.title || r.name || '',
      year: String(date).slice(0, 4),
      posterUrl: r.posterPath ? IMG + r.posterPath : null,
      overview: r.overview || '',
      rating: r.voteAverage || 0,
      status: (r.mediaInfo && r.mediaInfo.status) || 0
    };
  }

  function createClient(cfg) {
    var base = normalizeBase(cfg.baseUrl) + '/api/v1';
    var key = String(cfg.apiKey || '').trim();
    var timeoutMs = cfg.timeoutMs || 10000;
    var doFetch = cfg.fetch || function (u, o) { return fetch(u, o); };

    function request(method, path, body) {
      var init = { method: method, headers: { 'X-Api-Key': key, 'Accept': 'application/json' } };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      var timer;
      var timeout = new Promise(function (resolve, reject) {
        timer = setTimeout(function () { reject(new ApiError('timeout', 'Seerr did not respond in time.')); }, timeoutMs);
      });
      var call = doFetch(base + path, init).then(function (res) {
        if (!res.ok) throw httpError(res.status);
        if (res.status === 204) return null;
        return res.json().catch(function () {
          throw new ApiError('parse', 'Unexpected response. Is this a Seerr URL?');
        });
      }, function () {
        throw new ApiError('network', 'Cannot reach Seerr. Check the URL and network.');
      });
      return Promise.race([call, timeout]).then(
        function (v) { clearTimeout(timer); return v; },
        function (e) { clearTimeout(timer); throw e; }
      );
    }

    function checkType(mediaType) {
      if (mediaType !== 'movie' && mediaType !== 'tv') {
        return Promise.reject(new ApiError('http', 'Unsupported media type.'));
      }
      return null;
    }

    return {
      getMe: function () { return request('GET', '/auth/me'); },

      search: function (query, page) {
        var q = String(query || '').trim();
        if (!q) return Promise.resolve([]);
        return request('GET', '/search?query=' + encodeURIComponent(q) + '&page=' + (page || 1)).then(function (data) {
          return ((data && data.results) || [])
            .filter(function (r) { return r.mediaType === 'movie' || r.mediaType === 'tv'; })
            .map(toItem);
        });
      },

      getDetail: function (mediaType, id) {
        var bad = checkType(mediaType);
        if (bad) return bad;
        return request('GET', '/' + mediaType + '/' + encodeURIComponent(id)).then(function (data) {
          var item = toItem({
            id: data.id, mediaType: mediaType, title: data.title, name: data.name,
            releaseDate: data.releaseDate, firstAirDate: data.firstAirDate, posterPath: data.posterPath,
            overview: data.overview, voteAverage: data.voteAverage, mediaInfo: data.mediaInfo
          });
          if (mediaType === 'tv') {
            item.seasons = (data.seasons || [])
              .filter(function (s) { return s.seasonNumber > 0; })
              .map(function (s) {
                return { number: s.seasonNumber, name: s.name || ('Season ' + s.seasonNumber), episodeCount: s.episodeCount || 0 };
              });
          }
          return item;
        });
      },

      requestMedia: function (mediaType, id, seasons) {
        var bad = checkType(mediaType);
        if (bad) return bad;
        var body = { mediaType: mediaType, mediaId: id };
        if (mediaType === 'tv') {
          if (!seasons || !seasons.length) {
            return Promise.reject(new ApiError('http', 'Select at least one season.'));
          }
          body.seasons = seasons;
        }
        return request('POST', '/request', body);
      }
    };
  }

  return {
    STATUS: STATUS, ApiError: ApiError, normalizeBase: normalizeBase,
    createClient: createClient, statusLabel: statusLabel, canRequest: canRequest
  };
});
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all PASS.

- [ ] **Step 5: Commit**
```bash
git add app/js/api.js test/api.test.js && git commit -m "feat: add Seerr API client"
```

---

### Task 7: Vendor Norigin + nav.js wrapper

**Files:**
- Create: `app/js/vendor/norigin.js` (generated), `app/js/nav.js`, `dev/nav-smoke.html`

**Interfaces:**
- Consumes: global `NoriginNav` (exports `init`, `setFocus`, `ROOT_FOCUS_KEY`, `SpatialNavigation`).
- Produces (`window.SR.nav`): `init()`; `group()` → `{ add(el, { onEnter?, onFocus? }): string, clear() }` (adds class `focused` to the focused element, removes on blur, sets `el._srKey`); `focusEl(el)` → Promise|undefined.

- [ ] **Step 1: Build the vendored bundle**

Run: `npm run vendor && ls -la app/js/vendor/norigin.js`
Expected: file exists, non-trivial size (tens of KB), no esbuild errors. If esbuild errors on a syntax target, report it (this is the "library fails on old Chromium" risk from the spec; do not silently switch approach).

- [ ] **Step 2: Write `app/js/nav.js`**
```js
(function (w) {
  var SR = (w.SR = w.SR || {});
  var N = w.NoriginNav;
  var seq = 0;
  function noop() {}

  function init() {
    N.init({ distanceCalculationMethod: 'center' });
  }

  function group() {
    var keys = [];
    return {
      add: function (el, handlers) {
        var h = handlers || {};
        var key = 'sr-' + (++seq);
        el._srKey = key;
        N.SpatialNavigation.addFocusable({
          focusKey: key,
          node: el,
          parentFocusKey: N.ROOT_FOCUS_KEY,
          onEnterPress: h.onEnter || noop,
          onEnterRelease: noop,
          onArrowPress: function () { return true; },
          onArrowRelease: noop,
          onFocus: function () {
            el.classList.add('focused');
            if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            if (h.onFocus) h.onFocus();
          },
          onBlur: function () { el.classList.remove('focused'); },
          onUpdateFocus: noop,
          onUpdateHasFocusedChild: noop,
          saveLastFocusedChild: false,
          trackChildren: false,
          preferredChildFocusKey: undefined,
          focusable: true,
          isFocusBoundary: false,
          autoRestoreFocus: true,
          forceFocus: false
        });
        keys.push(key);
        return key;
      },
      clear: function () {
        keys.forEach(function (k) { N.SpatialNavigation.removeFocusable({ focusKey: k }); });
        keys = [];
      }
    };
  }

  function focusEl(el) {
    if (el && el._srKey) return N.setFocus(el._srKey);
  }

  SR.nav = { init: init, group: group, focusEl: focusEl };
})(window);
```

- [ ] **Step 3: Write smoke page** — `dev/nav-smoke.html`
```html
<!doctype html><meta charset="utf-8"><title>nav smoke</title>
<style>.t{display:inline-block;width:80px;height:80px;margin:8px;background:#ccc}.focused{outline:4px solid red}</style>
<div id="g"></div><div id="out"></div>
<script src="../app/js/vendor/norigin.js"></script>
<script src="../app/js/nav.js"></script>
<script>
  SR.nav.init();
  var g = SR.nav.group(), els = [];
  for (var i = 0; i < 6; i++) {
    var d = document.createElement('div'); d.className = 't'; d.textContent = i;
    document.getElementById('g').appendChild(d);
    (function (n) { g.add(d, { onEnter: function () { document.getElementById('out').textContent = 'enter ' + n; } }); })(i);
    els.push(d);
  }
  SR.nav.focusEl(els[0]);
</script>
```

- [ ] **Step 4: Verify in desktop Chrome**

Serve and open: `python3 -m http.server 8080` in the project root, open `http://localhost:8080/dev/nav-smoke.html` (chrome-devtools MCP is available for this). Expected: tile 0 has a red outline; ArrowRight moves the outline to tile 1, ArrowLeft back; Enter prints `enter N` in `#out`; no console errors. Fix `nav.js` (not the bundle) until this works. If focus never appears, check the console for Norigin errors and inspect `NoriginNav.getCurrentFocusKey()`.

- [ ] **Step 5: Commit**
```bash
git add app/js/vendor app/js/nav.js dev package.json package-lock.json && git commit -m "feat: vendor Norigin spatial navigation and add nav wrapper"
```

---

### Task 8: Shell, styles, mock Seerr, keyboard view, setup view, app bootstrap

**Files:**
- Create: `scripts/mock-seerr.js`, `app/index.html`, `app/css/app.css`, `app/js/dom.js`, `app/js/keyboard-view.js`, `app/js/view-setup.js`, `app/js/view-search.js` (stub), `app/js/view-detail.js` (stub), `app/js/app.js`

**Interfaces:**
- Consumes: `SR.nav`, `SR.keyboard`, `SR.api`, `SR.store`, `SR.util`, `SR.seasons`.
- Produces: `SR.h(tag, attrs, children)` (attrs: `class`, `text`, others as attributes; children: nodes/strings/falsy skipped); `SR.clear(el)`; `SR.toast(msg, kind?)`; `SR.mountKeyboard(container, kb, nav)` → `{ focusFirst(), destroy() }`; views `SR.viewSetup(ctx)`, `SR.viewSearch(ctx)`, `SR.viewDetail(ctx, item)` each returning `{ name, destroy(), onBack() }`; `ctx = { root, nav, cfg, client, store, searchState: {text, items, focusIndex}, show(name, arg?), exit(), onSaved(cfg) }`.

- [ ] **Step 1: Mock Seerr** — `scripts/mock-seerr.js`
```js
const http = require('http');
const KEY = process.env.MOCK_KEY || 'testkey';
const PORT = Number(process.env.PORT || 5055);

const ITEMS = [
  { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-31', posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', overview: 'A hacker learns the truth about reality.', voteAverage: 8.2 },
  { id: 604, mediaType: 'movie', title: 'The Matrix Reloaded', releaseDate: '2003-05-15', posterPath: null, overview: 'Already in the library.', voteAverage: 7.0, mediaInfo: { status: 5 } },
  { id: 1396, mediaType: 'tv', name: 'Breaking Bad', firstAirDate: '2008-01-20', posterPath: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', overview: 'A teacher turns to crime.', voteAverage: 8.9,
    seasons: [{ seasonNumber: 0, name: 'Specials', episodeCount: 3 }, { seasonNumber: 1, episodeCount: 7 }, { seasonNumber: 2, episodeCount: 13 }, { seasonNumber: 3, episodeCount: 13 }] },
  { id: 777, mediaType: 'tv', name: 'Specials Only Show', firstAirDate: '2020-01-01', posterPath: null, overview: 'Only a specials season.', voteAverage: 5,
    seasons: [{ seasonNumber: 0, name: 'Specials', episodeCount: 2 }] },
  { id: 5, mediaType: 'person', name: 'Keanu Reeves' }
];

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-api-key'] !== KEY) return send(res, 403, { message: 'bad key' });
  const p = url.pathname;
  if (p === '/api/v1/auth/me') return send(res, 200, { id: 1 });
  if (p === '/api/v1/search') {
    const q = (url.searchParams.get('query') || '').toLowerCase();
    const results = ITEMS.filter((i) => (i.title || i.name).toLowerCase().includes(q));
    return setTimeout(() => send(res, 200, { page: 1, totalResults: results.length, results }), 150);
  }
  const m = p.match(/^\/api\/v1\/(movie|tv)\/(\d+)$/);
  if (m) {
    const item = ITEMS.find((i) => i.id === Number(m[2]) && i.mediaType === m[1]);
    return item ? send(res, 200, item) : send(res, 404, {});
  }
  if (p === '/api/v1/request' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      console.log('REQUEST', b);
      send(res, b.mediaId === 1396 ? 409 : 201, b.mediaId === 1396 ? { message: 'exists' } : { id: 1 });
    });
    return;
  }
  send(res, 404, {});
}).listen(PORT, () => console.log('mock seerr on :' + PORT + ' key=' + KEY));
```
Note: mock returns 409 for Breaking Bad to exercise the conflict path.

- [ ] **Step 2: `app/index.html`**
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Seerr Request</title>
  <meta name="viewport" content="width=1920, initial-scale=1">
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <div id="app"></div>
  <div id="toast"></div>
  <script src="js/util.js"></script>
  <script src="js/store.js"></script>
  <script src="js/keyboard.js"></script>
  <script src="js/seasons.js"></script>
  <script src="js/api.js"></script>
  <script src="js/vendor/norigin.js"></script>
  <script src="js/dom.js"></script>
  <script src="js/nav.js"></script>
  <script src="js/keyboard-view.js"></script>
  <script src="js/view-setup.js"></script>
  <script src="js/view-search.js"></script>
  <script src="js/view-detail.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: `app/css/app.css`**
```css
:root { --bg: #0b0d12; --panel: #151922; --tile: #232938; --text: #f2f4f8; --muted: #8d95a8; --accent: #e50914; --ok: #2fbf71; --warn: #e0a526; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); color: var(--text); font: 28px/1.3 Arial, Helvetica, sans-serif; }
.screen { display: flex; height: 100%; padding: 48px 64px; }
.panel-left { width: 600px; flex: none; }
.panel-right { flex: 1; min-width: 0; padding-left: 48px; display: flex; flex-direction: column; }
h1 { margin: 0 0 24px; font-size: 44px; }

.keyboard { display: grid; grid-template-columns: repeat(6, 84px); grid-auto-rows: 84px; gap: 8px; }
.key { background: var(--tile); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 36px; }
.key-space, .key-delete, .key-clear, .key-shift, .key-layer { font-size: 24px; color: var(--muted); }
.focused { outline: 5px solid #fff; background: #3a4258; transform: scale(1.06); position: relative; z-index: 2; }

.query { height: 84px; line-height: 84px; padding: 0 24px; margin-bottom: 20px; background: var(--panel); border-radius: 8px; font-size: 38px; white-space: nowrap; overflow: hidden; }
.query.placeholder { color: var(--muted); }
.message { min-height: 40px; color: var(--muted); margin: 8px 0 16px; }
.hint { position: absolute; left: 64px; bottom: 24px; color: var(--muted); font-size: 22px; }

.results { display: grid; grid-template-columns: repeat(5, 200px); grid-auto-rows: 440px; gap: 24px; overflow-y: auto; flex: 1; padding: 8px; }
.results::-webkit-scrollbar { display: none; }
.card { width: 200px; background: var(--panel); border-radius: 8px; overflow: hidden; }
.poster { display: block; width: 200px; height: 300px; object-fit: cover; background: var(--tile); }
.poster-missing { display: flex; align-items: center; justify-content: center; font-size: 80px; color: var(--muted); }
.card-title { padding: 8px 10px 0; font-size: 22px; height: 60px; overflow: hidden; }
.card-meta { padding: 0 10px; font-size: 18px; color: var(--muted); }
.badge { display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 4px; font-size: 16px; color: #000; background: var(--warn); }
.badge-5 { background: var(--ok); }

.field { background: var(--panel); border-radius: 8px; padding: 14px 24px; margin-bottom: 16px; }
.field.active { box-shadow: inset 0 0 0 3px var(--accent); }
.field-label { color: var(--muted); font-size: 20px; }
.field-value { font-size: 34px; min-height: 44px; word-break: break-all; }
.button { display: inline-block; padding: 18px 40px; margin: 0 16px 16px 0; background: var(--tile); border-radius: 8px; font-size: 30px; }
.button.primary { background: var(--accent); }
.button.disabled { opacity: 0.45; }

.detail .poster-wrap { flex: none; width: 400px; }
.detail .poster { width: 400px; height: 600px; border-radius: 8px; }
.detail .info { flex: 1; padding-left: 56px; min-width: 0; }
.overview { max-height: 220px; overflow: hidden; margin: 16px 0 24px; color: #cfd5e3; }
.chips { margin-bottom: 24px; }
.chip { display: inline-block; min-width: 84px; text-align: center; padding: 10px 18px; margin: 0 10px 10px 0; background: var(--tile); border-radius: 8px; font-size: 26px; }
.chip.on { background: #2b5a8a; }

#toast { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%); padding: 18px 40px; border-radius: 8px; background: #222; font-size: 30px; display: none; z-index: 10; }
#toast.show { display: block; }
#toast.error { background: #8b1d24; }
```

- [ ] **Step 4: `app/js/dom.js`**
```js
(function (w) {
  var SR = (w.SR = w.SR || {});

  SR.h = function (tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (!c) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  };

  SR.clear = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  };

  var toastTimer;
  SR.toast = function (msg, kind) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 4000);
  };
})(window);
```

- [ ] **Step 5: `app/js/keyboard-view.js`**
```js
(function (w) {
  var SR = w.SR, h = SR.h;

  SR.mountKeyboard = function (container, kb, nav) {
    var group = nav.group();
    var firstEl = null;

    function render(match) {
      group.clear();
      SR.clear(container);
      var focusEl = null;
      firstEl = null;
      kb.layout().forEach(function (row) {
        row.forEach(function (key) {
          var el = h('div', { 'class': 'key key-' + key.action, text: key.display, style: 'grid-column: span ' + key.span });
          group.add(el, {
            onEnter: function () {
              var relayout = kb.press(key);
              if (relayout) {
                render(key.action === 'char'
                  ? function (k) { return k.id === key.id; }
                  : function (k) { return k.action === key.action; });
              }
            }
          });
          if (!firstEl) firstEl = el;
          if (match && match(key)) focusEl = el;
          container.appendChild(el);
        });
      });
      if (focusEl) nav.focusEl(focusEl);
    }

    render();
    return {
      focusFirst: function () { nav.focusEl(firstEl); },
      destroy: function () { group.clear(); SR.clear(container); }
    };
  };
})(window);
```

- [ ] **Step 6: `app/js/view-setup.js`**
```js
(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewSetup = function (ctx) {
    var root = ctx.root;
    var fields = { url: ctx.cfg ? ctx.cfg.baseUrl : 'http://', key: ctx.cfg ? ctx.cfg.apiKey : '' };
    var active = 'url';
    var busy = false;
    var group = ctx.nav.group();

    var kbEl = h('div', { 'class': 'keyboard' });
    var urlVal = h('div', { 'class': 'field-value' });
    var keyVal = h('div', { 'class': 'field-value' });
    var urlEl = h('div', { 'class': 'field' }, [h('div', { 'class': 'field-label', text: 'Seerr URL' }), urlVal]);
    var keyEl = h('div', { 'class': 'field' }, [h('div', { 'class': 'field-label', text: 'API key (Seerr > Settings > General)' }), keyVal]);
    var saveEl = h('div', { 'class': 'button primary', text: 'Save & connect' });
    var msgEl = h('div', { 'class': 'message' });

    var kb = SR.keyboard.createKeyboard({
      text: fields.url,
      onChange: function (t) { fields[active] = t; paint(); }
    });

    function paint() {
      urlVal.textContent = fields.url;
      keyVal.textContent = fields.key;
      urlEl.className = 'field' + (active === 'url' ? ' active' : '');
      keyEl.className = 'field' + (active === 'key' ? ' active' : '');
    }

    function select(name) {
      active = name;
      kb.setText(fields[name]);
      paint();
    }

    function connect() {
      if (busy) return;
      var url = SR.api.normalizeBase(fields.url);
      var apiKey = fields.key.trim();
      if (!apiKey) { msgEl.textContent = 'Enter your API key.'; return; }
      busy = true;
      msgEl.textContent = 'Connecting...';
      SR.api.createClient({ baseUrl: url, apiKey: apiKey }).getMe().then(function () {
        busy = false;
        ctx.onSaved({ baseUrl: url, apiKey: apiKey });
      }, function (err) {
        busy = false;
        msgEl.textContent = err.message;
      });
    }

    group.add(urlEl, { onEnter: function () { select('url'); } });
    group.add(keyEl, { onEnter: function () { select('key'); } });
    group.add(saveEl, { onEnter: connect });

    var kbView = SR.mountKeyboard(kbEl, kb, ctx.nav);
    root.appendChild(h('div', { 'class': 'screen setup' }, [
      h('div', { 'class': 'panel-left' }, [kbEl]),
      h('div', { 'class': 'panel-right' }, [
        h('h1', { text: 'Connect to Seerr' }),
        urlEl, keyEl, h('div', {}, [saveEl]), msgEl
      ])
    ]));
    paint();
    kbView.focusFirst();

    return {
      name: 'setup',
      destroy: function () { group.clear(); kbView.destroy(); SR.clear(root); },
      onBack: function () { if (ctx.cfg) ctx.show('search'); else ctx.exit(); }
    };
  };
})(window);
```

- [ ] **Step 7: Stub views** (replaced in Tasks 9/10) — `app/js/view-search.js`
```js
(function (w) {
  w.SR.viewSearch = function (ctx) {
    ctx.root.appendChild(w.SR.h('div', { 'class': 'message', text: 'search view (stub)' }));
    return { name: 'search', destroy: function () { w.SR.clear(ctx.root); }, onBack: function () { ctx.exit(); } };
  };
})(window);
```
`app/js/view-detail.js`
```js
(function (w) {
  w.SR.viewDetail = function (ctx) {
    return { name: 'detail', destroy: function () {}, onBack: function () { ctx.show('search'); } };
  };
})(window);
```

- [ ] **Step 8: `app/js/app.js`**
```js
(function (w) {
  var SR = w.SR;
  var store = SR.store.createStore();
  var cfg = store.load();

  var ctx = {
    root: document.getElementById('app'),
    nav: SR.nav,
    store: store,
    cfg: cfg,
    client: cfg ? SR.api.createClient(cfg) : null,
    searchState: { text: '', items: [], focusIndex: -1 }
  };
  var views = { setup: SR.viewSetup, search: SR.viewSearch, detail: SR.viewDetail };
  var current = null;

  ctx.show = function (name, arg) {
    if (current) current.destroy();
    current = views[name](ctx, arg);
  };

  ctx.exit = function () {
    try { w.tizen.application.getCurrentApplication().exit(); } catch (e) { w.close(); }
  };

  ctx.onSaved = function (newCfg) {
    ctx.cfg = newCfg;
    ctx.client = SR.api.createClient(newCfg);
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
  ctx.show(cfg ? 'search' : 'setup');
})(window);
```

- [ ] **Step 9: Verify in desktop Chrome**

Run in one terminal: `npm run mock` (key `testkey`, port 5055). In another: `python3 -m http.server 8080`, open `http://localhost:8080/app/index.html` (use chrome-devtools MCP or a browser).
Expected: setup screen shows a 6-column square keyboard (7 rows) and the two fields. Arrows move focus across keys; Enter types; DEL/CLR/Aa/`#+=` work (symbols layer shows `:/.-_@`); moving right from the keyboard reaches the fields; Enter on a field makes it active; typing `http://localhost:5055` and key `testkey`, then Save → "Connecting..." then the stub search view. A wrong key shows "Seerr rejected the API key."; a dead URL shows "Cannot reach Seerr...". Reload after success → goes straight to the stub search view (config persisted). No console errors.

- [ ] **Step 10: Commit**
```bash
git add app scripts && git commit -m "feat: app shell, mock Seerr, keyboard view and setup screen"
```

---

### Task 9: Search view

**Files:**
- Modify (replace): `app/js/view-search.js`

**Interfaces:**
- Consumes: `ctx.client.search`, `ctx.searchState` (`{text, items, focusIndex}`), `SR.util.debounce/latestOnly`, `SR.mountKeyboard`, `SR.api.statusLabel`, `ctx.show('detail', item)`.
- Produces: `SR.viewSearch(ctx)` → `{ name: 'search', destroy(), onBack() }`; state in `ctx.searchState` survives navigation to detail and back.

- [ ] **Step 1: Replace `app/js/view-search.js`**
```js
(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewSearch = function (ctx) {
    var root = ctx.root;
    var st = ctx.searchState;
    var kbEl = h('div', { 'class': 'keyboard' });
    var queryEl = h('div', { 'class': 'query' });
    var msgEl = h('div', { 'class': 'message' });
    var gridEl = h('div', { 'class': 'results' });
    var cardsGroup = ctx.nav.group();
    var cards = [];
    var next = SR.util.latestOnly();

    var kb = SR.keyboard.createKeyboard({
      text: st.text,
      onChange: function (t) { st.text = t; paintQuery(); runSearch(); }
    });
    var runSearch = SR.util.debounce(search, 400);

    function setMsg(t) { msgEl.textContent = t; }

    function paintQuery() {
      queryEl.textContent = st.text || 'Search movies & TV';
      queryEl.className = 'query' + (st.text ? '' : ' placeholder');
    }

    function posterFor(item) {
      var missing = function () { return h('div', { 'class': 'poster poster-missing', text: item.title.charAt(0) }); };
      if (!item.posterUrl) return missing();
      var img = h('img', { 'class': 'poster', src: item.posterUrl, alt: '' });
      img.onerror = function () { if (img.parentNode) img.parentNode.replaceChild(missing(), img); };
      return img;
    }

    function renderResults() {
      cardsGroup.clear();
      SR.clear(gridEl);
      cards = [];
      st.items.forEach(function (item, i) {
        var label = SR.api.statusLabel(item.status);
        var meta = h('div', { 'class': 'card-meta' }, [
          (item.year ? item.year + ' · ' : '') + (item.mediaType === 'tv' ? 'TV' : 'Movie'),
          label ? h('span', { 'class': 'badge badge-' + item.status, text: label }) : null
        ]);
        var card = h('div', { 'class': 'card' }, [posterFor(item), h('div', { 'class': 'card-title', text: item.title }), meta]);
        cardsGroup.add(card, { onEnter: function () { st.focusIndex = i; ctx.show('detail', item); } });
        cards.push(card);
        gridEl.appendChild(card);
      });
    }

    function search() {
      var q = st.text.trim();
      var isCurrent = next();
      if (!q) { st.items = []; renderResults(); setMsg('Type to search.'); return; }
      setMsg('Searching...');
      ctx.client.search(q).then(function (items) {
        if (!isCurrent()) return;
        st.items = items;
        st.focusIndex = -1;
        renderResults();
        setMsg(items.length ? '' : 'No results for "' + q + '".');
      }, function (err) {
        if (!isCurrent()) return;
        setMsg(err.kind === 'auth' ? 'API key rejected. Press RED to open settings.' : err.message);
      });
    }

    var kbView = SR.mountKeyboard(kbEl, kb, ctx.nav);
    root.appendChild(h('div', { 'class': 'screen search' }, [
      h('div', { 'class': 'panel-left' }, [queryEl, kbEl]),
      h('div', { 'class': 'panel-right' }, [msgEl, gridEl])
    ]));
    root.appendChild(h('div', { 'class': 'hint', text: 'RED: settings   BACK: exit' }));

    paintQuery();
    renderResults();
    setMsg(st.items.length ? '' : (st.text.trim() ? '' : 'Type to search.'));
    if (st.focusIndex >= 0 && cards[st.focusIndex]) ctx.nav.focusEl(cards[st.focusIndex]);
    else kbView.focusFirst();

    return {
      name: 'search',
      destroy: function () {
        runSearch.cancel();
        next(); // invalidate in-flight searches
        cardsGroup.clear();
        kbView.destroy();
        SR.clear(root);
      },
      onBack: function () { ctx.exit(); }
    };
  };
})(window);
```

- [ ] **Step 2: Verify in desktop Chrome** (mock + http.server running as in Task 8)

Expected, with config `http://localhost:5055` / `testkey` saved:
- Typing `matrix` (via the on-screen keys) shows two movie cards after ~0.4 s; "The Matrix Reloaded" has an "Available" badge; no person result.
- Typing `x` then deleting everything shows "Type to search." and no cards.
- Rapidly typing then deleting does not leave stale results (the mock has a 150 ms delay).
- Moving right from the keyboard focuses cards; moving down scrolls the grid.
- Searching `zzz` shows `No results for "zzz".`; stopping the mock and searching shows "Cannot reach Seerr...".
- Back (Esc) calls `window.close` (browser may ignore it); F2 opens setup.

- [ ] **Step 3: Commit**
```bash
git add app/js/view-search.js && git commit -m "feat: add search view with debounced, stale-safe search"
```

---

### Task 10: Detail view and request flow

**Files:**
- Modify (replace): `app/js/view-detail.js`

**Interfaces:**
- Consumes: `ctx.client.getDetail/requestMedia`, `SR.seasons.createSelection`, `SR.api.canRequest/statusLabel`, `SR.toast`, `ctx.show('search')`.
- Produces: `SR.viewDetail(ctx, item)`; mutates `item.status`/`item.overview`/`item.seasons` so the search view reflects the result when returning.

- [ ] **Step 1: Replace `app/js/view-detail.js`**
```js
(function (w) {
  var SR = w.SR, h = SR.h;

  SR.viewDetail = function (ctx, item) {
    var root = ctx.root;
    var group = ctx.nav.group();
    var screen = h('div', { 'class': 'screen detail' }, [h('div', { 'class': 'message', text: 'Loading...' })]);
    root.appendChild(screen);
    var alive = true;
    var busy = false;

    var load = item.mediaType === 'tv'
      ? ctx.client.getDetail('tv', item.id)
      : Promise.resolve(item);

    load.then(function (d) {
      if (!alive) return;
      if (d !== item) {
        item.overview = d.overview || item.overview;
        item.seasons = d.seasons || [];
        item.status = d.status;
      }
      render();
    }, function (err) {
      if (!alive) return;
      SR.toast(err.message, 'error');
      ctx.show('search');
    });

    function render() {
      SR.clear(screen);
      var sel = SR.seasons.createSelection((item.seasons || []).map(function (s) { return s.number; }));
      var chipEls = [];
      var badgeEl = h('span', { 'class': 'badge' });
      var reqEl = h('div', { 'class': 'button primary' });
      var backEl = h('div', { 'class': 'button', text: 'Back' });

      function reqState() {
        if (!SR.api.canRequest(item.status)) return { label: SR.api.statusLabel(item.status), enabled: false };
        if (item.mediaType === 'tv' && !(item.seasons || []).length) return { label: 'No seasons available', enabled: false };
        if (item.mediaType === 'tv' && sel.count() === 0) return { label: 'Select a season', enabled: false };
        return { label: 'Request', enabled: true };
      }

      function paint() {
        var label = SR.api.statusLabel(item.status);
        badgeEl.textContent = label;
        badgeEl.className = label ? 'badge badge-' + item.status : '';
        chipEls.forEach(function (c) { c.el.className = 'chip' + (c.isOn() ? ' on' : ''); });
        var st = reqState();
        reqEl.textContent = st.label;
        reqEl.className = 'button primary' + (st.enabled ? '' : ' disabled');
      }

      function doRequest() {
        var st = reqState();
        if (!st.enabled) { SR.toast(st.label, 'error'); return; }
        if (busy) return;
        busy = true;
        ctx.client.requestMedia(item.mediaType, item.id, item.mediaType === 'tv' ? sel.selected() : undefined)
          .then(function () {
            item.status = SR.api.STATUS.PENDING;
            SR.toast('Requested: ' + item.title);
          }, function (err) {
            if (err.kind === 'conflict') item.status = SR.api.STATUS.PENDING;
            SR.toast(err.message, 'error');
          })
          .then(function () { busy = false; if (alive) paint(); });
      }

      var poster = item.posterUrl
        ? h('img', { 'class': 'poster', src: item.posterUrl, alt: '' })
        : h('div', { 'class': 'poster poster-missing', text: item.title.charAt(0) });

      var info = h('div', { 'class': 'info' }, [
        h('h1', { text: item.title + (item.year ? ' (' + item.year + ')' : '') }),
        h('div', {}, [
          (item.mediaType === 'tv' ? 'TV' : 'Movie') + (item.rating ? '  ★ ' + item.rating.toFixed(1) : '') + '  ',
          badgeEl
        ]),
        h('div', { 'class': 'overview', text: item.overview })
      ]);

      if (item.mediaType === 'tv' && (item.seasons || []).length) {
        var chips = h('div', { 'class': 'chips' });
        var allEl = h('div', { 'class': 'chip', text: 'All' });
        chipEls.push({ el: allEl, isOn: function () { return sel.allSelected(); } });
        group.add(allEl, { onEnter: function () { sel.toggleAll(); paint(); } });
        chips.appendChild(allEl);
        item.seasons.forEach(function (s) {
          var el = h('div', { 'class': 'chip', text: 'S' + s.number });
          chipEls.push({ el: el, isOn: function () { return sel.isSelected(s.number); } });
          group.add(el, { onEnter: function () { sel.toggle(s.number); paint(); } });
          chips.appendChild(el);
        });
        info.appendChild(chips);
      }

      group.add(reqEl, { onEnter: doRequest });
      group.add(backEl, { onEnter: function () { ctx.show('search'); } });
      info.appendChild(h('div', {}, [reqEl, backEl]));

      screen.appendChild(h('div', { 'class': 'poster-wrap' }, [poster]));
      screen.appendChild(info);
      paint();
      ctx.nav.focusEl(reqEl);
    }

    return {
      name: 'detail',
      destroy: function () { alive = false; group.clear(); SR.clear(root); },
      onBack: function () { ctx.show('search'); }
    };
  };
})(window);
```

- [ ] **Step 2: Verify in desktop Chrome** (mock + http.server running)

Expected:
- Search `matrix`, open "The Matrix": Request is focused; Enter → toast `Requested: The Matrix`, badge becomes "Requested", button becomes disabled "Requested"; the mock terminal logs `REQUEST { mediaType: 'movie', mediaId: 603 }`. Back → search card for it now shows the "Requested" badge.
- Open "The Matrix Reloaded": button reads "Available" and Enter shows a toast without a request.
- Search `breaking`, open it: chips All, S1, S2, S3 (no Specials), all lit. Deselecting all → button "Select a season", Enter shows toast, no request. Select S1+S2 → Enter → mock logs `seasons: [1, 2]` and returns 409 → toast "Already requested." and status becomes Requested.
- Search `specials`, open it: button "No seasons available", no chips.
- Esc returns to search with query and results preserved and the card focused.

- [ ] **Step 3: Commit**
```bash
git add app/js/view-detail.js && git commit -m "feat: add detail view with season selection and request flow"
```

---

### Task 11: CORS probe, README, spec sync

**Files:**
- Create: `scripts/cors-probe.sh`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-05-seerr-request-module-design.md` (setup validation line)

- [ ] **Step 1: `scripts/cors-probe.sh`** (then `chmod +x`)
```bash
#!/usr/bin/env bash
# Usage: scripts/cors-probe.sh http://seerr.lan:5055 YOUR_API_KEY
# Checks whether Seerr sends CORS headers a browser page would need.
set -euo pipefail
base="${1:?seerr base url}"; key="${2:?api key}"
echo "== preflight (OPTIONS) =="
curl -sS -i -X OPTIONS "$base/api/v1/auth/me" \
  -H 'Origin: http://localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-api-key' | grep -iE '^HTTP/|^access-control' || true
echo "== actual GET =="
curl -sS -i "$base/api/v1/auth/me" -H "X-Api-Key: $key" -H 'Origin: http://localhost' \
  | grep -iE '^HTTP/|^access-control' || true
echo
echo "Direct fetch works only if access-control-allow-origin is present (and allow-headers lists x-api-key on the preflight)."
echo "If missing, the module needs the Node proxy contingency (new plan)."
```

- [ ] **Step 2: Run against the user's Seerr** — ask the user for their Seerr URL/key (do not guess), run the script, and report the output verbatim. Decision rule: `access-control-allow-origin` present → direct fetch OK; absent → stop and tell the user a proxy plan is needed.

- [ ] **Step 3: `README.md`** — include: what it is; install in TizenBrew (add the module by its GitHub/npm path via TizenBrew's module manager, e.g. `gh/<user>/<repo>`, exact entry format per TizenBrew UI); first-run setup (Seerr URL + API key from Seerr > Settings > General); controls (D-pad, Enter, Back = exit/back, RED = settings); desktop dev (`npm install`, `npm test`, `npm run mock`, `python3 -m http.server`, open `app/index.html`, F2 = settings, Esc = back); troubleshooting (CORS probe; HTTPS Seerr vs HTTP mixed content; keys note).

- [ ] **Step 4: Spec sync** — in the spec's Flow section change "Save validates via `GET {url}/api/v1/status`" to "Save validates via `GET {url}/api/v1/auth/me` (the public `/status` endpoint does not check the key)".

- [ ] **Step 5: Final verification**

Run: `npm test`
Expected: all tests pass. Then confirm `git status` is clean after commit.

- [ ] **Step 6: Commit**
```bash
git add scripts README.md docs && git commit -m "docs: add CORS probe, README, sync spec"
```

- [ ] **Step 7: Hand to user for on-TV verification** — list what only they can verify: TizenBrew installs/launches the module, `appPath` resolves, Norigin works on their TV's Chromium, remote keys (arrows, Enter, Back 10009, RED 403) behave, posters load, real Seerr request lands in Radarr/Sonarr.
