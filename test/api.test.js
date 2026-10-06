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
