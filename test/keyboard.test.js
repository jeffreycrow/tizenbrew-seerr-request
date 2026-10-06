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
