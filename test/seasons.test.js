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
