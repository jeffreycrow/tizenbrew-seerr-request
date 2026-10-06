'use strict';
// Local CORS proxy for the Seerr Request TizenBrew module.
// TizenBrew runs this file in its Node service (possibly Node 4.4.3), so keep the
// syntax ES5-style, use only core modules, and keep everything in this one file.
var http = require('http');
var https = require('https');
var urlLib = require('url');
var os = require('os');
var crypto = require('crypto');
var querystring = require('querystring');

var PORT = 8765;
var HOST = '127.0.0.1';
var PREFIX = '/proxy/';
var FORWARD_HEADERS = ['x-api-key', 'content-type', 'accept'];

var MAX_PROXY_BODY = 65536;
var MAX_REDIRECTS = 5;
var REDIRECT_CODES = [301, 302, 303, 307, 308];

var SETUP_PORT = 8766;
var SETUP_MAX_BODY = 8192;
var SETUP_MAX_ATTEMPTS = 5;
var SETUP_MAX_KEY = 512;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-seerr-url, x-api-key, content-type, accept');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function parseBase(value) {
  var s = String(value || '').trim().replace(/\/+$/, '');
  var u;
  try { u = urlLib.parse(s); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  if (u.port && !(/^\d+$/.test(u.port) && Number(u.port) >= 1 && Number(u.port) <= 65535)) return null;
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || undefined,
    prefix: (u.pathname || '').replace(/\/+$/, '')
  };
}

function pathAllowed(pathOnly) {
  return pathOnly.indexOf('api/v1/') === 0 && !/(^|\/)\.\.(\/|$)/.test(pathOnly);
}

// ---- Phone pairing: a short-lived LAN page where the user pastes the Seerr URL and API key ----

var SETUP_PAGE = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Seerr Request setup</title>',
  '<style>body{font-family:sans-serif;margin:0;padding:20px;background:#0b0d12;color:#f2f4f8}',
  'label{display:block;margin:16px 0 6px;color:#8d95a8}',
  'input,textarea{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border-radius:8px;border:1px solid #333;background:#151922;color:#f2f4f8}',
  'button{margin-top:24px;width:100%;font-size:20px;padding:14px;border:0;border-radius:8px;background:#e50914;color:#fff}</style></head><body>',
  '<h2>Seerr Request setup</h2>',
  '<form method="post" action="/submit">',
  '<label for="url">Seerr URL</label><input id="url" name="url" placeholder="192.168.1.10:5055" autocapitalize="none" autocorrect="off" spellcheck="false">',
  '<label for="key">API key</label><textarea id="key" name="key" rows="3" autocapitalize="none" autocorrect="off" spellcheck="false"></textarea>',
  '<label for="pin">PIN shown on your TV</label><input id="pin" name="pin" inputmode="numeric" maxlength="6" autocomplete="off">',
  '<button type="submit">Send to TV</button></form></body></html>'
].join('');

function sendRaw(res, code, html) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function sendNote(res, code, text) {
  sendRaw(res, code, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:sans-serif;padding:20px"><p>' + text + '</p>' + (code === 200 ? '' : '<p><a href="/">Back</a></p>') + '</body>');
}

function makePin() {
  return ('000000' + (parseInt(crypto.randomBytes(4).toString('hex'), 16) % 1000000)).slice(-6);
}

function loopbackOrigin(origin) {
  return /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(origin));
}

// JSON reply for the setup API; origin (when given) is echoed as the only allowed CORS origin.
function sendSetupJson(res, code, obj, origin) {
  var body = JSON.stringify(obj);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function localAddresses(port) {
  var out = [];
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    ifs[name].forEach(function (a) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push('http://' + a.address + ':' + port);
    });
  });
  return out;
}

function createPairing(opts) {
  opts = opts || {};
  var host = opts.host || '0.0.0.0';
  var port = opts.port === undefined ? SETUP_PORT : opts.port;
  var lifetimeMs = opts.timeoutMs || 600000;
  var state = null;
  var starting = null;

  function close() {
    if (!state) return;
    var s = state;
    state = null;
    clearTimeout(s.timer);
    try { s.server.close(); } catch (e) { /* already closed */ }
  }

  function info(s) {
    var p = s.server.address().port;
    return { pin: s.pin, port: p, addresses: localAddresses(p) };
  }

  function handleForm(s, raw, res) {
    var f = querystring.parse(raw);
    var pin = String(f.pin || '').trim();
    if (pin !== s.pin) {
      s.attempts += 1;
      if (s.attempts >= SETUP_MAX_ATTEMPTS) {
        sendNote(res, 403, 'Too many wrong PINs. Start again on the TV.');
        if (state === s) close();
        return;
      }
      return sendNote(res, 403, 'Wrong PIN. Check your TV and try again.');
    }
    var url = String(f.url || '').trim();
    // phones people type "192.168.1.10:5055": add the scheme the way the page's normalizeBase does
    if (url && !/^[a-z][a-z0-9+.\-]*:\/\//i.test(url)) url = 'http://' + url;
    var key = String(f.key || '').trim();
    if (!parseBase(url)) return sendNote(res, 400, 'Could not read that Seerr URL. Example: http://192.168.1.10:5055');
    if (!key || key.length > SETUP_MAX_KEY) return sendNote(res, 400, 'The API key is missing or too long.');
    s.config = { baseUrl: url, apiKey: key };
    sendNote(res, 200, 'Done! Your TV is connecting. You can close this page.');
  }

  function readSubmit(s, req, res) {
    var size = 0;
    var chunks = [];
    var tooBig = false;
    req.on('data', function (c) {
      if (tooBig) return;
      size += c.length;
      if (size > SETUP_MAX_BODY) {
        tooBig = true;
        chunks = [];
        return sendNote(res, 413, 'Too much data.');
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (tooBig) return;
      handleForm(s, Buffer.concat(chunks).toString('utf8'), res);
    });
  }

  function handleSetup(s, req, res) {
    if (req.method === 'GET' && req.url === '/') return sendRaw(res, 200, SETUP_PAGE);
    if (req.method === 'POST' && req.url === '/submit') return readSubmit(s, req, res);
    sendNote(res, 404, 'Not found');
  }

  function start(cb) {
    if (state) return cb(null, info(state));
    if (starting) { starting.push(cb); return; }
    starting = [cb];
    var s = { server: null, pin: makePin(), attempts: 0, config: null, timer: null };
    var settled = false;
    function finish(err, result) {
      var list = starting;
      starting = null;
      list.forEach(function (f) { f(err, result); });
    }
    s.server = http.createServer(function (req, res) {
      try { handleSetup(s, req, res); } catch (e) { sendNote(res, 500, 'Something went wrong. Start again on the TV.'); }
    });
    s.server.on('error', function (e) {
      if (settled) return;
      settled = true;
      finish(e);
    });
    s.server.listen(port, host, function () {
      settled = true;
      state = s;
      s.timer = setTimeout(close, lifetimeMs);
      finish(null, info(s));
    });
  }

  function poll() {
    if (!state) return { status: 'idle' };
    if (state.config) {
      var c = state.config;
      close();
      return { status: 'done', baseUrl: c.baseUrl, apiKey: c.apiKey };
    }
    return { status: 'waiting' };
  }

  return { start: start, poll: poll, cancel: close };
}

var sharedPairing = null;
function defaultPairing() {
  if (!sharedPairing) sharedPairing = createPairing();
  return sharedPairing;
}

// A redirect may upgrade http to https, but never downgrade https to http (the API key would go out in cleartext).
function followDecision(fromProtocol, toProtocol) {
  return !(fromProtocol === 'https:' && toProtocol === 'http:');
}

function createProxyServer(opts) {
  var timeoutMs = (opts && opts.timeoutMs) || 30000;
  var pairing = (opts && opts.pairing) || defaultPairing();

  // The setup API hands out the API key, so only loopback web pages (the app itself, or desktop
  // dev) may use it; CORS is granted to that exact origin, never '*'. Pages from other sites
  // get a 403 with no CORS headers.
  function handleSetupApi(req, res) {
    var origin = req.headers.origin;
    if (origin !== undefined && !loopbackOrigin(origin)) return sendSetupJson(res, 403, { message: 'Origin not allowed' }, null);
    var allowed = origin === undefined ? null : origin;
    if (req.url === '/setup/start' && req.method === 'POST') {
      req.resume();
      pairing.start(function (err, result) {
        if (err) return sendSetupJson(res, 500, { message: 'Cannot open the phone setup port: ' + (err.code || 'error') }, allowed);
        sendSetupJson(res, 200, result, allowed);
      });
      return;
    }
    if (req.url === '/setup/poll' && req.method === 'GET') return sendSetupJson(res, 200, pairing.poll(), allowed);
    if (req.url === '/setup/cancel' && req.method === 'POST') {
      req.resume();
      pairing.cancel();
      return sendSetupJson(res, 200, { ok: true }, allowed);
    }
    sendSetupJson(res, 404, { message: 'Not found' }, allowed);
  }

  return http.createServer(function (req, res) {
    // Never let a bad request throw out of the handler: TizenBrew's Node process hosts this service.
    try {
      handle(req, res);
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { message: 'Proxy error' });
      else res.end();
    }
  });

  function handle(req, res) {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }
    if (req.url === '/health') return sendJson(res, 200, { ok: true });
    if (req.url.indexOf('/setup/') === 0) return handleSetupApi(req, res);
    if (req.url.indexOf(PREFIX) !== 0) return sendJson(res, 404, { message: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { message: 'Method not allowed' });

    var rest = req.url.slice(PREFIX.length);
    if (!pathAllowed(rest.split('?')[0])) return sendJson(res, 403, { message: 'Only /api/v1 paths are proxied' });

    var base = parseBase(req.headers['x-seerr-url']);
    if (!base) return sendJson(res, 400, { message: 'Missing or invalid X-Seerr-Url header' });

    var headers = {};
    FORWARD_HEADERS.forEach(function (h) { if (req.headers[h]) headers[h] = req.headers[h]; });

    var origHost = String(base.hostname).toLowerCase();
    var current = null;
    var chunks = [];
    var size = 0;
    var tooBig = false;

    function emptyBody() { return Buffer.alloc ? Buffer.alloc(0) : new Buffer(0); }

    function fail(message) { sendJson(res, 502, { message: message }); }

    // Follow a redirect, but only within the same host: the API key must not leave the Seerr server.
    function follow(code, location, from, method, body, hops) {
      if (hops >= MAX_REDIRECTS) return fail('Seerr redirected too many times. Check the URL.');
      var next;
      try {
        var abs = urlLib.parse(urlLib.resolve(from.protocol + '//' + from.hostname + (from.port ? ':' + from.port : '') + from.path, location));
        next = parseBase(abs.protocol + '//' + abs.host);
        if (next) next.path = abs.path;
      } catch (e) { next = null; }
      if (!next) return fail('Seerr sent a redirect that could not be followed.');
      if (String(next.hostname).toLowerCase() !== origHost) {
        return fail('Seerr redirected to a different address (' + next.protocol + '//' + next.hostname + (next.port ? ':' + next.port : '') + '). Use that URL instead.');
      }
      if (!followDecision(from.protocol, next.protocol)) {
        return fail('Seerr redirected from HTTPS to HTTP, which is not allowed because it would send your API key unencrypted.');
      }
      var nextMethod = method;
      var nextBody = body;
      if (code === 303 && method !== 'GET') { nextMethod = 'GET'; nextBody = emptyBody(); }
      forward({ protocol: next.protocol, hostname: next.hostname, port: next.port, path: next.path }, nextMethod, nextBody, hops + 1);
    }

    function forward(target, method, body, hops) {
      var h = {};
      Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
      if (body.length) h['content-length'] = body.length; else delete h['content-type'];

      var timedOut = false;
      var lib = target.protocol === 'https:' ? https : http;
      var up;
      try {
        up = lib.request({
          hostname: target.hostname,
          port: target.port,
          path: target.path,
          method: method,
          headers: h
        }, function (ures) {
          var code = ures.statusCode;
          if (REDIRECT_CODES.indexOf(code) !== -1 && ures.headers.location) {
            ures.resume();
            return follow(code, ures.headers.location, target, method, body, hops);
          }
          setCors(res);
          var out = {};
          if (ures.headers['content-type']) out['Content-Type'] = ures.headers['content-type'];
          res.writeHead(code, out);
          ures.pipe(res);
        });
      } catch (e) {
        return fail('Cannot reach Seerr: bad address');
      }
      current = up;
      up.setTimeout(timeoutMs, function () { timedOut = true; up.abort(); });
      up.on('error', function (e) {
        if (res.headersSent) return res.end();
        sendJson(res, timedOut ? 504 : 502, { message: timedOut ? 'Seerr timed out' : 'Cannot reach Seerr: ' + (e && e.code ? e.code : e) });
      });
      up.end(body);
    }

    req.on('aborted', function () { if (current) current.abort(); });
    req.on('data', function (c) {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_PROXY_BODY) {
        tooBig = true;
        chunks = [];
        return sendJson(res, 413, { message: 'Request too large' });
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (tooBig) return;
      forward({ protocol: base.protocol, hostname: base.hostname, port: base.port, path: base.prefix + '/' + rest }, req.method, Buffer.concat(chunks), 0);
    });
  }
}

function start() {
  var server = createProxyServer();
  server.on('error', function (e) {
    console.log('Seerr proxy: ' + (e && e.code === 'EADDRINUSE' ? 'already running on ' + PORT : e));
  });
  server.listen(PORT, HOST, function () {
    console.log('Seerr proxy listening on ' + HOST + ':' + PORT);
  });
  return server;
}

module.exports = {
  createProxyServer: createProxyServer, createPairing: createPairing, followDecision: followDecision, start: start,
  PORT: PORT, HOST: HOST, SETUP_PORT: SETUP_PORT
};

if (!(typeof process !== 'undefined' && process.env && process.env.SR_NO_START)) start();
