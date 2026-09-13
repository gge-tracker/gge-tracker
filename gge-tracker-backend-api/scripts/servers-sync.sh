#!/bin/bash
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../." && pwd)"
ENV_FILE="${SERVERS_ENV_FILE:-$API_DIR/../.env}"

env_value() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^(['\"])(.*)\1\$/\2/" || true
}

REMOTE_HOST="${SERVERS_REMOTE_HOST:-$(env_value SERVERS_REMOTE_HOST)}"
REMOTE_FILE="${SERVERS_REMOTE_FILE:-$(env_value SERVERS_REMOTE_FILE)}"
LOCAL_FILE="${SERVERS_FILE:-$API_DIR/config/servers.xml}"
BACKUPS_KEPT=10
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
REMOTE_COPY="$WORK_DIR/remote.xml"
ASSUME_YES=false

usage() {
  cat <<EOF
Usage: $(basename "$0") <diff|pull|push> [--yes]

  diff   what a push would change on production (exit 1 when the two files differ)
  pull   replace the local file with the production one
  push   validate the local file, then replace the production one

Both sides keep the last $BACKUPS_KEPT copies as servers.xml.bak-<date>.
SERVERS_REMOTE_HOST and SERVERS_REMOTE_FILE are read from the repository .env when not exported.
SERVERS_FILE overrides the local file, SERVERS_ENV_FILE the .env location.
EOF
}

require_remote() {
  if [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_FILE" ]; then
    echo "SERVERS_REMOTE_HOST and SERVERS_REMOTE_FILE must be set, exported or in $ENV_FILE" >&2
    exit 2
  fi
}

fetch_remote() {
  if ! ssh -o ConnectTimeout=8 "$REMOTE_HOST" "cat $(printf '%q' "$REMOTE_FILE")" > "$REMOTE_COPY"; then
    echo "Cannot read $REMOTE_FILE on $REMOTE_HOST - is the VPN up?" >&2
    exit 2
  fi
}

sha_of() {
  sha256sum "$1" | cut -d' ' -f1
}

validate() {
  (cd "$API_DIR" && SERVERS_CHECK_FILE="$1" npx --no-install ts-node --transpile-only -e \
    "try { new (require('./src/api/managers/servers-catalog').ServersCatalog)(process.env.SERVERS_CHECK_FILE).load() }
      catch (error) { console.error(error.message); process.exit(1) }" \
    > /dev/null)
}

semantic_diff() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import sys
import xml.etree.ElementTree as ET

def servers(path):
    def flatten(element, prefix=''):
        fields = {}
        for child in element:
            key = prefix + child.tag
            if len(child):
                fields.update(flatten(child, key + '/'))
            else:
                fields[key] = (child.text or '').strip()
        return fields
    rows = {}
    for server in ET.parse(path).getroot().iter('server'):
        rows[(server.findtext('name') or '').strip()] = flatten(server)
    return rows

old_path, new_path, old_label, new_label = sys.argv[1:5]
old, new = servers(old_path), servers(new_path)
lines = []
for name in new:
    if name not in old:
        lines.append(f'+ {name:<14} only in {new_label}')
        continue
    for field in dict.fromkeys([*old[name], *new[name]]):
        before, after = old[name].get(field, '<absent>'), new[name].get(field, '<absent>')
        if before != after:
            lines.append(f'~ {name:<14} {field}: {before or "<empty>"} -> {after or "<empty>"}')
for name in old:
    if name not in new:
        lines.append(f'- {name:<14} only in {old_label}')
shared_old = [name for name in old if name in new]
shared_new = [name for name in new if name in old]
if shared_old != shared_new:
    lines.append('~ server order differs (the public catalog follows the file order)')

if lines:
    print(f'{old_label} -> {new_label}:')
    print('\n'.join(lines))
    sys.exit(1)
if open(old_path, 'rb').read() != open(new_path, 'rb').read():
    print('Same servers and values, only formatting or comments differ.')
    sys.exit(1)
print('Identical.')
PY
}

confirm() {
  $ASSUME_YES && return 0
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[yY]$ ]]
}

prune_local_backups() {
  ls -1t "$LOCAL_FILE".bak-* 2> /dev/null | tail -n +$((BACKUPS_KEPT + 1)) | xargs -r rm --
}

run_diff() {
  fetch_remote
  semantic_diff "$REMOTE_COPY" "$LOCAL_FILE" prod local
}

run_pull() {
  fetch_remote
  if ! validate "$REMOTE_COPY"; then
    echo "Warning: the production file does not pass validation; the API there is still serving the previous one" >&2
  fi
  if [ -f "$LOCAL_FILE" ] && semantic_diff "$LOCAL_FILE" "$REMOTE_COPY" local prod; then
    return 0
  fi
  confirm "Overwrite $LOCAL_FILE with the production copy?" || exit 1
  if [ -f "$LOCAL_FILE" ]; then
    cp -p "$LOCAL_FILE" "$LOCAL_FILE.bak-$STAMP"
    prune_local_backups
  fi
  cp "$REMOTE_COPY" "$LOCAL_FILE"
  echo "Pulled. Previous local copy: $LOCAL_FILE.bak-$STAMP"
}

run_push() {
  if ! validate "$LOCAL_FILE"; then
    echo "Refusing to push: $LOCAL_FILE does not pass validation" >&2
    exit 1
  fi
  fetch_remote
  if semantic_diff "$REMOTE_COPY" "$LOCAL_FILE" prod local; then
    return 0
  fi
  confirm "Replace the production file with this one?" || exit 1

  local incoming="$REMOTE_FILE.push-$STAMP"
  ssh -o ConnectTimeout=8 "$REMOTE_HOST" "cat > $(printf '%q' "$incoming")" < "$LOCAL_FILE"
  ssh -o ConnectTimeout=8 "$REMOTE_HOST" bash -s -- \
    "$(printf '%q' "$REMOTE_FILE")" "$(printf '%q' "$incoming")" "$(sha_of "$REMOTE_COPY")" "$STAMP" "$BACKUPS_KEPT" <<'REMOTE'
set -euo pipefail
file="$1"; incoming="$2"; expected="$3"; stamp="$4"; kept="$5"
swap="$(dirname "$file")/.$(basename "$file").swp"
if [ -e "$swap" ]; then
  rm -f "$incoming"
  echo "Refusing to push: $swap exists" >&2
  exit 3
fi
if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$expected" ]; then
  rm -f "$incoming"
  echo "Refusing to push: the production file changed since it was read : just run the command again" >&2
  exit 4
fi
cp -p "$file" "$file.bak-$stamp"
chmod --reference="$file" "$incoming"
mv -f "$incoming" "$file"
ls -1t "$file".bak-* | tail -n +$((kept + 1)) | xargs -r rm --
echo "Pushed. Previous production copy: $file.bak-$stamp"
REMOTE
}

command="${1:-}"
[ "${2:-}" = "--yes" ] && ASSUME_YES=true
case "$command" in
  diff) require_remote; run_diff ;;
  pull) require_remote; run_pull ;;
  push) require_remote; run_push ;;
  *) usage; exit 2 ;;
esac
