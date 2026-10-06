const http = require('http');
const KEY = process.env.MOCK_KEY || 'testkey';
const PORT = Number(process.env.PORT || 5055);

const ITEMS = [
  { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-31', posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', overview: 'A hacker learns the truth about reality.', voteAverage: 8.2, voteCount: 28883, popularity: 53.5 },
  { id: 604, mediaType: 'movie', title: 'The Matrix Reloaded', releaseDate: '2003-05-15', posterPath: null, overview: 'Already in the library.', voteAverage: 7.0, voteCount: 12374, popularity: 25, mediaInfo: { status: 5 } },
  { id: 1396, mediaType: 'tv', name: 'Breaking Bad', firstAirDate: '2008-01-20', posterPath: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', overview: 'A teacher turns to crime.', voteAverage: 8.9, voteCount: 15000, popularity: 90,
    seasons: [{ seasonNumber: 0, name: 'Specials', episodeCount: 3 }, { seasonNumber: 1, episodeCount: 7 }, { seasonNumber: 2, episodeCount: 13 }, { seasonNumber: 3, episodeCount: 13 }] },
  { id: 777, mediaType: 'tv', name: 'Specials Only Show', firstAirDate: '2020-01-01', posterPath: null, overview: 'Only a specials season.', voteAverage: 5, voteCount: 100, popularity: 5,
    seasons: [{ seasonNumber: 0, name: 'Specials', episodeCount: 2 }] },
  { id: 5, mediaType: 'person', name: 'Keanu Reeves' }
];

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

http.createServer((req, res) => {
  const NO_CORS = !!process.env.MOCK_NO_CORS; // behave like the real Seerr: no CORS headers, preflight 405
  if (!NO_CORS) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'x-api-key, content-type, accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return send(res, NO_CORS ? 405 : 204);
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
      console.log('REQUEST', JSON.stringify(b));
      send(res, b.mediaId === 1396 ? 409 : 201, b.mediaId === 1396 ? { message: 'exists' } : { id: 1 });
    });
    return;
  }
  send(res, 404, {});
}).listen(PORT, () => console.log('mock seerr on :' + PORT + ' key=' + KEY));
