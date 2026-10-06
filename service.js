'use strict';
// Local CORS proxy for the Seerr Request TizenBrew module.
// TizenBrew runs this file in its Node service (possibly Node 4.4.3), so keep the
// syntax ES5-style, use only core modules, and keep everything in this one file.
var http = require('http');
var https = require('https');
var urlLib = require('url');

var PORT = 8765;
var HOST = '127.0.0.1';
var PREFIX = '/proxy/';
var FORWARD_HEADERS = ['x-api-key', 'content-type', 'accept'];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-seerr-url, x-api-key, content-type, accept');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseBase(value) {
  var s = String(value || '').trim().replace(/\/+$/, '');
  var u = urlLib.parse(s);
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
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

function createProxyServer(opts) {
  var timeoutMs = (opts && opts.timeoutMs) || 30000;

  return http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }
    if (req.url === '/health') return sendJson(res, 200, { ok: true });
    if (req.url.indexOf(PREFIX) !== 0) return sendJson(res, 404, { message: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { message: 'Method not allowed' });

    var rest = req.url.slice(PREFIX.length);
    if (!pathAllowed(rest.split('?')[0])) return sendJson(res, 403, { message: 'Only /api/v1 paths are proxied' });

    var base = parseBase(req.headers['x-seerr-url']);
    if (!base) return sendJson(res, 400, { message: 'Missing or invalid X-Seerr-Url header' });

    var headers = {};
    FORWARD_HEADERS.forEach(function (h) { if (req.headers[h]) headers[h] = req.headers[h]; });
    if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

    var timedOut = false;
    var lib = base.protocol === 'https:' ? https : http;
    var up = lib.request({
      hostname: base.hostname,
      port: base.port,
      path: base.prefix + '/' + rest,
      method: req.method,
      headers: headers
    }, function (ures) {
      setCors(res);
      var out = {};
      if (ures.headers['content-type']) out['Content-Type'] = ures.headers['content-type'];
      res.writeHead(ures.statusCode, out);
      ures.pipe(res);
    });

    up.setTimeout(timeoutMs, function () { timedOut = true; up.abort(); });
    up.on('error', function (e) {
      if (res.headersSent) return res.end();
      sendJson(res, timedOut ? 504 : 502, { message: timedOut ? 'Seerr timed out' : 'Cannot reach Seerr: ' + (e && e.code ? e.code : e) });
    });
    req.on('aborted', function () { up.abort(); });
    req.pipe(up);
  });
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

module.exports = { createProxyServer: createProxyServer, start: start, PORT: PORT, HOST: HOST };

if (!(typeof process !== 'undefined' && process.env && process.env.SR_NO_START)) start();
