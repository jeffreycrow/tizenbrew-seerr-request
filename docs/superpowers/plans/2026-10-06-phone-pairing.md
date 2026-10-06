# Phone Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen) or subagent-driven-development. TDD for every logic step.

**Goal:** Let the user enter the Seerr URL and API key from a phone instead of the TV keyboard.

**Architecture:** `service.js` gains a pairing controller (`createPairing`) that runs a short-lived LAN HTTP server and a loopback API on the existing proxy. The page gets `SR.api` helpers and a "Set up from phone" button in the setup view.

**Tech Stack:** Node core modules only in the service (`http`, `os`, `crypto`, `querystring`, `url`), Node-4-safe syntax; `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-05-seerr-request-module-design.md` (Addendum 2026-10-06)

## Global Constraints
- `service.js` stays one self-contained, Node-4-compatible file (existing ban-list test applies: no async/await, spread, destructuring, `?.`, `??`, template literals, default params, `**`); callbacks, not promises, in the service.
- Pairing server default `0.0.0.0:8766`; loopback API stays on `127.0.0.1:8765`; PIN is 6 digits; max 5 wrong PINs; body limit 8 KB; API key ≤ 512 chars; pairing lifetime 10 min.
- `poll` returns the config once and clears it. Never log the key or PIN.
- Page code stays ES2017-safe; setup view keeps the keyboard fallback.

## Review Focus
1. Wrong PIN, repeated wrong PINs (lockout closes pairing), oversized body, invalid URL, empty key must never store a config (Task 1).
2. A config is returned by `poll` exactly once; after that and after timeout/cancel the key is gone (Task 1).
3. Pairing server is closed in every exit path (done, cancel, lockout, timeout) so port 8766 is never left open (Task 1).
4. Cancelling on the TV (Back) while the start request is in flight must still close the server (Task 3).
5. The setup view still works without the proxy (button hidden, keyboard entry intact) (Task 3).

---

### Task 1: Pairing controller + loopback API in service.js
**Files:** Modify `service.js`; Test `test/pairing.test.js`.
**Interfaces:** Produces `createPairing({host?, port?, timeoutMs?}) → {start(cb(err, {pin, port, addresses})), poll() → {status, baseUrl?, apiKey?}, cancel()}`; `createProxyServer({timeoutMs?, pairing?})` routes `POST /setup/start`, `GET /setup/poll`, `POST /setup/cancel` to it (CORS headers, JSON); module exports `createPairing`, `SETUP_PORT = 8766`.
Tests (write first, watch fail): start returns 4-digit pin + addresses; `GET /` serves a form containing fields `url`, `key`, `pin`; valid submit → poll `done` once then `idle`; wrong pin → 403 and nothing stored; 5 wrong pins → closed (idle, connection refused); bad URL / `ftp://` / bad port / empty key / key > 512 → 400, nothing stored; body > 8 KB → 413; cancel → idle + refused; timeout (small `timeoutMs`) → idle; start twice returns same pin while active; loopback routes via proxy server (start/poll/cancel JSON + CORS); `service.js` still passes the Node-4 ban test.

### Task 2: api.js pairing helpers
**Files:** Modify `app/js/api.js`; Test `test/api-pairing.test.js`.
**Interfaces:** Produces `startPairing(proxyUrl, {fetch?}) → Promise<{pin, port, addresses}>`, `pollPairing(proxyUrl, {fetch?}) → Promise<{status,...}>`, `cancelPairing(proxyUrl, {fetch?})`, `waitForPairing(proxyUrl, {fetch?, intervalMs?=1500, timeoutMs?=600000, shouldStop?}) → Promise<{baseUrl, apiKey}|null>`; non-2xx → `ApiError('http')`, fetch failure → `ApiError('network')`; `waitForPairing` retries transient poll failures, resolves null on `idle`, timeout, or `shouldStop()`.
Tests: URLs/methods (POST start, GET poll, POST cancel, no custom headers), trailing slash trimmed, error mapping, wait resolves on done after waiting polls, null on idle, null on shouldStop, null on timeout, retries after a rejected poll.

### Task 3: Setup view button, pairing panel, CSS
**Files:** Modify `app/js/view-setup.js`, `app/css/app.css`.
**Interfaces:** Consumes `ctx.proxyUrl`, `SR.api.*Pairing`, `connect()` (existing). Button "Set up from phone" only when `ctx.proxyUrl`; shows phone URL(s) + PIN, "Waiting for your phone... (Back to cancel)"; on done fills fields and runs the existing connect; Back cancels (and closes the server even if start was in flight); `destroy` cancels; initial focus on the button when present.
Verify in desktop Chrome with `node service.js` + `MOCK_NO_CORS=1 npm run mock` + a `curl` standing in for the phone: button hidden without the service; with it, PIN/URL shown, wrong-PIN curl rejected, correct curl submit connects and lands on the search view; Back cancels (port 8766 refuses); keyboard fallback still types.

### Task 4: Docs, version, publish
**Files:** Modify `README.md`, `package.json` (0.3.0).
README: first-run section describes phone pairing (address + PIN, paste URL and key, key crosses LAN once over HTTP, 10-minute window) and the keyboard fallback. Merge to `main`, tag `v0.3.0`, push `main` + tag to `origin` (repo `jeffreycrow/tizenbrew-seerr-request`), verify jsDelivr serves `@v0.3.0`.
