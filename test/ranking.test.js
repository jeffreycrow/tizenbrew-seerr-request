const test = require('node:test');
const assert = require('node:assert/strict');
const { rankResults, compactCount, MIN_VOTES, HOT_POPULARITY } = require('../app/js/api.js');

const it = (title, voteCount, popularity, extra) => Object.assign({ id: title, title, voteCount, popularity }, extra);

test('thresholds', () => {
  assert.equal(MIN_VOTES, 50);
  assert.equal(HOT_POPULARITY, 20);
});

test('popularOnly keeps titles with enough votes or high popularity, drops the rest, and counts them', () => {
  const input = [it('keep-votes', 50, 0), it('drop-49', 49, 19.99), it('keep-hot-new', 0, 20), it('drop-zero', 0, 0), it('keep-big', 5000, 2)];
  const r = rankResults(input, { popularOnly: true });
  assert.deepEqual(r.items.map((x) => x.title).sort(), ['keep-big', 'keep-hot-new', 'keep-votes']);
  assert.equal(r.hidden, 2);
});

test('popularOnly sorts by votes descending, then popularity descending, stably', () => {
  const input = [it('b', 100, 5), it('a', 100, 9), it('c', 9000, 1), it('d', 100, 5), it('e', 60, 30)];
  const r = rankResults(input, { popularOnly: true });
  assert.deepEqual(r.items.map((x) => x.title), ['c', 'a', 'b', 'd', 'e']);
});

test('popularOnly:false returns every item in the original order with nothing hidden', () => {
  const input = [it('x', 0, 0), it('y', 9000, 50), it('z', 3, 1)];
  const r = rankResults(input, { popularOnly: false });
  assert.deepEqual(r.items.map((x) => x.title), ['x', 'y', 'z']);
  assert.equal(r.hidden, 0);
});

test('rankResults does not mutate its input and tolerates missing fields', () => {
  const input = [{ id: 1, title: 'no-fields' }, it('ok', 500, 1)];
  const copy = JSON.stringify(input);
  const r = rankResults(input, { popularOnly: true });
  assert.equal(JSON.stringify(input), copy);
  assert.deepEqual(r.items.map((x) => x.title), ['ok']);
  assert.equal(r.hidden, 1);
  assert.deepEqual(rankResults([], { popularOnly: true }), { items: [], hidden: 0 });
});

test('real-world sample: the Matrix franchise stays, junk is hidden', () => {
  const sample = [
    it('The Matrix', 28883, 53.5), it('The Matrix Reloaded', 12374, 25), it('Threat Matrix', 6, 11.9),
    it('The Matrix Revolutions', 11187, 20.3), it('Matrix (tv 1993)', 4, 6.1), it('The Matrix: Generation', 25, 2.5),
    it('Armitage III: Poly Matrix', 72, 3.2), it('Matrix Dreads', 0, 4.3), it('Dinosaur Matrix', 0, 0.9)
  ];
  const r = rankResults(sample, { popularOnly: true });
  assert.deepEqual(r.items.map((x) => x.title), ['The Matrix', 'The Matrix Reloaded', 'The Matrix Revolutions', 'Armitage III: Poly Matrix']);
  assert.equal(r.hidden, 5);
});

test('compactCount formats vote counts for cards', () => {
  assert.equal(compactCount(0), '0');
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(1000), '1k');
  assert.equal(compactCount(1234), '1.2k');
  assert.equal(compactCount(28883), '29k');
  assert.equal(compactCount(999499), '999k');
  assert.equal(compactCount(1500000), '1.5M');
  assert.equal(compactCount(undefined), '0');
});
