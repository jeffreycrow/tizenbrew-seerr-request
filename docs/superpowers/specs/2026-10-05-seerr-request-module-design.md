# Seerr Request — TizenBrew Module Design

## Goal
A TizenBrew **app** module (`packageType: "app"`) that lets the user search Seerr from a Samsung TV remote and request movies/TV. Seerr already forwards requests to Radarr/Sonarr, so the module only talks to Seerr. It replaces Samsung's IME with a custom Netflix-style on-screen keyboard.

## Decisions (agreed)
- Auth: Seerr API key (`X-Api-Key`); requests are attributed to the key's user.
- Keyboard: square tiles, 6 columns: `a–f / g–l / m–r / s–x / y z 1 2 3 4 / 5–0`, then a row of space / delete / clear. Separate symbols layer (`: / . - _ @ ? # & =`) used for URL/API key entry.
- Focus: Norigin Spatial Navigation (framework-agnostic core), vendored into `app/js/vendor/` (no build step). Fallback: hand-written grid navigation if the library fails on the user's TV Chromium.
- Networking: direct `fetch` from the page first. A Node `serviceFile` proxy is added only if the probe hits CORS/mixed-content failures.
- Out of scope: 4K requests, per-user login, request management/approval, discovery/trending pages.

## Files
- `package.json` — `packageType: "app"`, `appName`, `appPath: "app/index.html"`, `keys` (arrows, Enter, Back, color keys), `evaluateScriptOnDocumentStart: false`.
- `app/index.html`, `app/css/app.css`
- `app/js/api.js` — Seerr client (`getStatus`, `search`, `getDetail`, `request`), injectable `fetch` for tests.
- `app/js/keyboard.js` — layout data + state (text, layer, shift); renders square focusable tiles.
- `app/js/nav.js` — wrapper over Norigin (init, focusable registration, back-stack).
- `app/js/views.js` — setup, search, detail/request views, toast.
- `app/js/store.js` — `localStorage` config (URL, API key), try/catch-guarded.
- `test/*.test.js` — Node tests for `api`, `keyboard`, `store`.

## Flow
1. **Setup (first run or Settings key):** two fields (Seerr URL, API key) edited with the keyboard (symbols layer available). Save validates via `GET {url}/api/v1/auth/me` (the public `/status` endpoint does not check the key); on success stores config.
2. **Search:** keyboard on left, poster grid on right. Debounced (~400 ms) `GET /api/v1/search?query=…&page=1`; drop `mediaType: "person"`. Each card shows poster, title, year, status badge from `mediaInfo.status` (available / partially available / pending / processing / not requested).
3. **Detail:** overview, year, rating, status. Movie → Request button → `POST /api/v1/request {mediaType:"movie", mediaId}`. TV → season picker (all by default) → `{mediaType:"tv", mediaId, seasons:[…]}`. Items already available/pending show a disabled button.
4. **Result:** toast on success or error (e.g. 409 already requested, 401/403 bad key → offer Settings, network failure → retry message).
5. **Back key:** detail → search → (exit app). In setup with saved config, Back returns to search.

## Error handling
- All `fetch` calls have a timeout (10 s) and map HTTP/network errors to user-readable messages.
- `localStorage` unavailable → in-memory config for the session, with a notice.
- Image load failure → placeholder tile.

## Testing
- Node unit tests (mock `fetch`): URL/headers construction, search filtering, request payloads for movie/TV, error mapping, keyboard layout/state transitions, store fallbacks.
- UI verified in desktop Chrome with arrow keys/Enter/Backspace(Back).
- Real-TV verification is done by the user (no device access). The first implementation task is a CORS probe against the user's Seerr; its result decides whether the proxy is built.

## Open risks
- Seerr CORS / mixed content (HTTPS page vs HTTP LAN Seerr) — handled by the probe, proxy as fallback.
- Norigin on older Tizen Chromium — fallback to custom grid nav.
- Exact TizenBrew app-module hosting/origin behavior unverified until tested on a TV.
