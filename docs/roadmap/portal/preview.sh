#!/usr/bin/env bash
# Preview the portal locally.
#   ./preview.sh          build + open in your browser
#   ./preview.sh serve    build + serve on the LAN so you can open it on your phone
set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="${TMPDIR:-/tmp}/dhara-portal"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/index.html"

# index.html is artifact-format (no doctype/head/body — those are added at publish
# time). Wrap it here so the local copy is a complete document with a viewport tag.
{
  printf '%s\n' '<!doctype html>'
  printf '%s\n' '<html lang="en">'
  printf '%s\n' '<head>'
  printf '%s\n' '<meta charset="utf-8">'
  printf '%s\n' '<meta name="viewport" content="width=device-width, initial-scale=1">'
  printf '%s\n' '</head>'
  printf '%s\n' '<body>'
  cat index.html
  printf '%s\n' '</body></html>'
} > "$OUT"

if [ "${1:-open}" = "serve" ]; then
  PORT="${PORT:-8055}"
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)
  echo "Portal:  http://localhost:$PORT/"
  echo "Phone:   http://$IP:$PORT/    (same wifi)"
  echo "Ctrl-C to stop."
  cd "$OUT_DIR" && exec python3 -m http.server "$PORT"
else
  echo "Built: $OUT"
  open "$OUT" 2>/dev/null || xdg-open "$OUT" 2>/dev/null || echo "Open that file in your browser."
fi
