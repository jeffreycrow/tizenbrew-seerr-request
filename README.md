# Seerr Request (TizenBrew module)

Search [Seerr](https://docs.seerr.dev) from your Samsung TV remote and request movies/TV. Seerr forwards the request to Radarr/Sonarr as usual. Uses a Netflix-style square on-screen keyboard instead of Samsung's.

## Install (TizenBrew)

TizenBrew loads modules from jsDelivr, so the module must be public first:

1. Push this repo to a public GitHub repo and create a version tag, e.g. `git tag v0.3.0 && git push --tags`.
2. In TizenBrew add the module as `gh/<user>/<repo>` (or `gh/<user>/<repo>@v0.3.0` to pin the tag; jsDelivr caches branch refs for hours, a tag avoids stale files). An npm package works too: `npm/<package>`.
3. Launch **Seerr Request**. TizenBrew starts the module's service (`service.js`) automatically.

If the service crashed, TizenBrew's module settings show the service status and error.

## How it talks to Seerr

Seerr sends no CORS headers, so a web page on the TV cannot call it directly. `service.js` runs on the TV as a tiny proxy on `127.0.0.1:8765` (loopback only, `/api/v1` paths only, GET/POST only). The page checks `http://127.0.0.1:8765/health` at startup and uses the proxy when it answers; otherwise it calls Seerr directly (desktop development, or a Seerr behind a reverse proxy that adds CORS headers). The API key is stored on the TV and sent only to your Seerr through the proxy. The proxy does not support self-signed HTTPS certificates. Calls time out after 30 s.

## First run

An API key is about 60 characters, so use **Set up from phone** (the button is focused on first run):

1. The TV shows one or more addresses like `http://192.168.1.50:8766` and a 6-digit PIN.
2. On a phone on the same network, open that address, paste your Seerr URL (include `http://` and the port) and API key (Seerr > Settings > General), type the PIN, and send.
3. The TV connects and takes you to search. The pairing page closes right after.

Pairing is deliberately narrow: it is open only while the TV shows the PIN, accepts one submission, closes after 5 wrong PINs or 10 minutes, and the key crosses your home network once over plain HTTP. Press **Back** on the TV to cancel it.

If the TV's service is not running (or you prefer), type the URL and key with the on-screen keyboard instead, then **Save & connect**. The `#+=` key switches to the symbols layer (`: / . - _ @` ...); `Aa` capitalizes the next letter (API keys are case-sensitive).

## Controls

| Key | Action |
| --- | --- |
| D-pad / Enter | Move / select |
| Back | Close detail, otherwise exit |
| Red | Settings |

Search is automatic (about 0.4 s after you stop typing). Select a title, pick seasons for TV (all by default), then **Request**.

## Development (desktop)

```bash
npm install
npm test                    # unit tests
npm run mock                # fake Seerr on :5055, key "testkey" (MOCK_NO_CORS=1 mimics real Seerr)
node service.js             # local proxy on :8765 (the page uses it automatically)
python3 -m http.server 8080 # then open http://localhost:8080/app/index.html
```

Desktop keys: arrows/Enter to navigate, Esc = Back, F2 = Settings. `npm run vendor` rebuilds the bundled Norigin spatial-navigation library.

## Troubleshooting

- **"Cannot reach Seerr"**: wrong URL/port, the TV cannot reach that IP, or the module's service is not running (check the service status in TizenBrew's module settings). On desktop without `node service.js` running, a Seerr without CORS headers is blocked by the browser; `scripts/cors-probe.sh <seerr-url> <api-key>` shows whether it sends them.
- **HTTPS Seerr**: fine. A page loaded over HTTPS cannot call an HTTP Seerr (mixed content).
- **"Seerr rejected the API key"**: press Red and re-enter it.
