#!/usr/bin/env node
'use strict';
// Builds a Tizen TV widget (.wgt) from app/ for sideloading with Apps2Samsung (which signs it).
//   npm run wgt -- --url http://192.168.1.10:5055 --key <api key>
// or SEERR_URL / SEERR_API_KEY in the environment. With credentials the package contains your
// API key: keep dist/ private. Without them the app asks for them on first run.
const fs = require('node:fs');
const path = require('node:path');
const { createZip } = require('./zip.js');
const { normalizeBase } = require('../app/js/api.js');

const ROOT = path.join(__dirname, '..');
const PACKAGE_ID = 'SeerrReq01'; // Tizen package ids are exactly 10 alphanumeric characters
const APP_NAME = 'SeerrRequest';

function buildConfigXml(opts) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://github.com/jeffreycrow/tizenbrew-seerr-request" version="' + opts.version + '" viewmodes="maximized">',
    '  <tizen:application id="' + PACKAGE_ID + '.' + APP_NAME + '" package="' + PACKAGE_ID + '" required_version="2.3"/>',
    '  <content src="index.html"/>',
    '  <feature name="http://tizen.org/feature/screen.size.all"/>',
    '  <icon src="icon.png"/>',
    '  <name>Seerr Request</name>',
    '  <tizen:profile name="tv"/>',
    '  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>',
    '  <tizen:privilege name="http://tizen.org/privilege/internet"/>',
    '  <access origin="*" subdomains="true"/>',
    '</widget>',
    ''
  ].join('\n');
}

// Values go through JSON.stringify, then < is escaped so a value can never close the <script> tag.
function buildConfigJs(opts) {
  const cfg = { proxy: false };
  if (opts.baseUrl && opts.apiKey) { cfg.baseUrl = opts.baseUrl; cfg.apiKey = opts.apiKey; }
  return 'window.SR_CONFIG = ' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';\n';
}

function makeIndexHtml(html) {
  const anchor = '<script src="js/app.js"></script>';
  if (html.indexOf(anchor) === -1) throw new Error('app/index.html has no ' + anchor + ' to insert config.js before');
  return html.replace(anchor, '<script src="js/config.js"></script>\n  ' + anchor);
}

function walk(dir, base) {
  let out = [];
  fs.readdirSync(dir).sort().forEach((name) => {
    if (name.charAt(0) === '.') return;
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) out = out.concat(walk(full, rel));
    else out.push({ name: rel, data: fs.readFileSync(full) });
  });
  return out;
}

function build(opts) {
  const o = opts || {};
  if (!!o.url !== !!o.key) throw new Error('Pass both --url and --key (or neither).');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const baked = !!(o.url && o.key);
  const baseUrl = baked ? normalizeBase(o.url) : undefined;
  const apiKey = baked ? String(o.key).trim() : undefined;

  const entries = walk(path.join(ROOT, 'app'), '').map((e) => (
    e.name === 'index.html' ? { name: e.name, data: Buffer.from(makeIndexHtml(e.data.toString('utf8')), 'utf8') } : e
  ));
  entries.push({ name: 'js/config.js', data: Buffer.from(buildConfigJs({ baseUrl: baseUrl, apiKey: apiKey }), 'utf8') });
  entries.push({ name: 'config.xml', data: Buffer.from(buildConfigXml({ version: pkg.version }), 'utf8') });
  entries.push({ name: 'icon.png', data: fs.readFileSync(path.join(ROOT, 'wgt', 'icon.png')) });

  const out = o.out || path.join(ROOT, 'dist', 'SeerrRequest.wgt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, createZip(entries, { date: o.date }));
  return { out: out, baked: baked, entries: entries.map((e) => e.name), version: pkg.version };
}

function parseArgs(argv, env) {
  const r = { url: env.SEERR_URL, key: env.SEERR_API_KEY, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let v;
    const eq = a.indexOf('=');
    if (a.indexOf('--') === 0 && eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq); }
    if (a === '--url' || a === '--key' || a === '--out') {
      if (v === undefined) v = argv[++i];
      r[a.slice(2)] = v;
    } else {
      throw new Error('Unknown option: ' + a);
    }
  }
  return r;
}

if (require.main === module) {
  try {
    const r = build(parseArgs(process.argv.slice(2), process.env));
    console.log('Built ' + r.out + ' (v' + r.version + ', ' + r.entries.length + ' files)');
    console.log(r.baked
      ? 'Your Seerr URL and API key are baked in: keep this file private.'
      : 'No credentials baked in: the app will ask for them on first run.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { build, buildConfigXml, buildConfigJs, makeIndexHtml, parseArgs };
