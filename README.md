# Seerr Request (TizenBrew module)

Search [Seerr](https://docs.seerr.dev) from your Samsung TV remote and request movies/TV. Seerr forwards the request to Radarr/Sonarr as usual. Uses a Netflix-style square on-screen keyboard instead of Samsung's.

## Install (TizenBrew)

Add the module in TizenBrew's module manager by its GitHub or npm path (for example `gh/<user>/<repo>`; use whatever entry format your TizenBrew version shows), then launch **Seerr Request**.

## First run

Enter your Seerr URL (e.g. `http://192.168.1.10:5055`) and an API key (Seerr > Settings > General), then **Save & connect**. The `#+=` key switches to the symbols layer (`: / . - _ @` ...); `Aa` capitalizes the next letter (API keys are case-sensitive).

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
npm run mock                # fake Seerr on :5055, key "testkey"
python3 -m http.server 8080 # then open http://localhost:8080/app/index.html
```

Desktop keys: arrows/Enter to navigate, Esc = Back, F2 = Settings. `npm run vendor` rebuilds the bundled Norigin spatial-navigation library.

## Troubleshooting

- **"Cannot reach Seerr"**: wrong URL/port, or the browser blocked the call. Run `scripts/cors-probe.sh <seerr-url> <api-key>`: `access-control-allow-origin` must be present. If it is missing, direct calls from the TV page cannot work and the module needs a proxy.
- **HTTPS Seerr**: fine. A page loaded over HTTPS cannot call an HTTP Seerr (mixed content).
- **"Seerr rejected the API key"**: press Red and re-enter it.
