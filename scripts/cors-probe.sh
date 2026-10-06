#!/usr/bin/env bash
# Usage: scripts/cors-probe.sh http://seerr.lan:5055 YOUR_API_KEY
# Checks whether Seerr sends CORS headers a browser page would need.
set -euo pipefail
base="${1:?seerr base url}"; key="${2:?api key}"
echo "== preflight (OPTIONS) =="
curl -sS -i -X OPTIONS "$base/api/v1/auth/me" \
  -H 'Origin: http://localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-api-key' | grep -iE '^HTTP/|^access-control' || true
echo "== actual GET =="
curl -sS -i "$base/api/v1/auth/me" -H "X-Api-Key: $key" -H 'Origin: http://localhost' \
  | grep -iE '^HTTP/|^access-control' || true
echo
echo "Direct fetch works only if access-control-allow-origin is present (and allow-headers lists x-api-key on the preflight)."
echo "If missing, the module needs the Node proxy contingency (new plan)."
