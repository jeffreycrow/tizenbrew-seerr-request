# Seerr Request (TizenBrew module)

Search [Seerr](https://docs.seerr.dev) from your Samsung TV remote and request movies/TV. Seerr forwards the request to Radarr/Sonarr as usual. Uses a Netflix-style square on-screen keyboard instead of Samsung's.

## Install (TizenBrew)

TizenBrew loads modules from jsDelivr, so the module must be public first:

1. Push this repo to a public GitHub repo and create a version tag, e.g. `git tag v0.4.0 && git push --tags`.
2. In TizenBrew add the module as `gh/<user>/<repo>` (or `gh/<user>/<repo>@v0.4.0` to pin the tag; jsDelivr caches branch refs for hours, a tag avoids stale files). An npm package works too: `npm/<package>`.
3. Launch **Seerr Request**. TizenBrew starts the module's service (`service.js`) automatically.

If the service crashed, TizenBrew's module settings show the service status and error.

## Install as a .wgt (Apps2Samsung, no TizenBrew)

You can also build a standalone Tizen widget and sideload it with [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) (it handles the signing certificate; your TV must be in Developer Mode):

```bash
npm run wgt -- --url http://192.168.1.10:5055 --key <your Seerr API key>
# or: SEERR_URL=... SEERR_API_KEY=... npm run wgt
```

This writes `dist/SeerrRequest.wgt`. In Apps2Samsung choose your TV, pick **custom .wgt**, and select that file.

- **Your URL and API key are baked into the file** (a widget has no service to pair a phone with, and a 60-character key is impractical to type). Keep `dist/` private; it is git-ignored. Build without `--url/--key` to get a credential-free package that asks on first run (on-screen keyboard).
- The app calls Seerr directly; `config.xml` grants the widget network access (`<access origin="*">`). If your Seerr is not reachable from the TV, or the TV blocks the call, the app shows "Cannot reach Seerr".
- Changing the baked credentials needs a rebuild and a reinstall (a config saved on the TV by Settings wins over the baked one).
- Package id `SeerrReq01.SeerrRequest`; to reinstall a new version, install over it from Apps2Samsung.

## How it talks to Seerr

Seerr sends no CORS headers, so a web page on the TV cannot call it directly. `service.js` runs on the TV as a tiny proxy on `127.0.0.1:8765` (loopback only, `/api/v1` paths only, GET/POST only). The page checks `http://127.0.0.1:8765/health` at startup and uses the proxy when it answers; otherwise it calls Seerr directly (desktop development, or a Seerr behind a reverse proxy that adds CORS headers). The API key is stored on the TV and sent only to your Seerr through the proxy. The proxy follows redirects within the same host (for example http to https; never https down to http). If your Seerr redirects to a different address, the app shows that address so you can use it instead. Self-signed HTTPS certificates are not supported. Calls time out after 30 s.

## First run

An API key is about 60 characters, so use **Set up from phone** (the button is focused on first run):

1. The TV shows one or more addresses like `http://192.168.1.50:8766` and a 6-digit PIN.
2. On a phone on the same network, open that address, paste your Seerr URL (e.g. `192.168.1.10:5055`; `http://` is added if you leave it off) and API key (Seerr > Settings > General), type the PIN, and send.
3. The TV connects and takes you to search. The pairing page closes right after.

Pairing is deliberately narrow: it is open only while the TV shows the PIN, accepts one submission, closes after 5 wrong PINs or 10 minutes, and the key crosses your home network once over plain HTTP. Press **Back** on the TV to cancel it.

If the TV's service is not running (or you prefer), type the URL and key with the on-screen keyboard instead, then **Save & connect**. The `#+=` key switches to the symbols layer (`: / . - _ @` ...); `Aa` capitalizes the next letter (API keys are case-sensitive).

## Controls

| Key | Action |
| --- | --- |
| D-pad / Enter | Move / select |
| Back | Close detail, otherwise exit |
| Red | Settings |

Search is automatic (about 0.4 s after you stop typing). **Popular only** (top of the results, on by default) hides obscure entries with very few votes and ranks the rest by votes; turn it off to see everything Seerr returns. Cards show the rating and vote count. Select a title, pick seasons for TV (all by default), then **Request**.

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
