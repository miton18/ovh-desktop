#!/usr/bin/env bash
# Télécharge les schémas JSON de l'API OVHcloud (endpoint EU) dans schemas/.
#
# Ces schémas sont la source de vérité des modèles de données : toute
# transcription dans src-tauri/src/ovh/models/ doit être vérifiable ici.
# Le dossier schemas/ n'est pas versionné — relance ce script au besoin.
set -euo pipefail

ROOT="${1:-https://eu.api.ovh.com}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/schemas"

for branch in v1 v2; do
  mkdir -p "$OUT/$branch"
  echo "── branche /$branch"
  curl -sSf "$ROOT/$branch/" \
    | python3 -c 'import json,sys;[print(a["path"].lstrip("/")) for a in json.load(sys.stdin)["apis"]]' \
    | while read -r section; do
        file="$OUT/$branch/$(echo "$section" | tr / _).json"
        curl -sSf -o "$file" "$ROOT/$branch/$section.json" && echo "   $section"
      done
done

echo "→ $(find "$OUT" -name '*.json' | wc -l) schémas dans $OUT"
