#!/bin/bash
#                                   __                        __
#    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
#   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
#  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
#  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
# /_____//_____/      \/                            \/     \/     \/    \/
#
#  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
#
# Builds the yearly Chronicle of every player into ClickHouse
#
#   run-docker-chronicle.sh --until=2026-11-30T23:00:00Z [--server=FR1,DE1] [--player=<id>]   dry run, writes nothing
#   run-docker-chronicle.sh --apply --until=2026-11-30T23:00:00Z [--server=...] [--replace]
#

set -eu

BASE_SCRIPT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
. "$BASE_SCRIPT_DIR/scripts/lib/servers.sh"
. "$BASE_SCRIPT_DIR/scripts/lib/fill-pause.sh"

LOCK_FILE="${CHRONICLE_LOCK:-/tmp/gge-tracker-chronicle.lock}"
MAX_EARLY_SECONDS=3600
SETTLE_SECONDS=30

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "Another Chronicle run is in progress (lock $LOCK_FILE)." >&2
    exit 1
fi

run_chronicle() {
    docker run --rm --network backend --env-file="$BASE_SCRIPT_DIR/.env" \
        --name ic-chronicle \
        -v "$SERVERS_CONFIG_DIR:/app/config:ro" \
        --cpus="2" \
        "$SERVERS_IMAGE" dist/chronicle-build.js "$@"
}

running_fills() {
    docker ps --format '{{.Names}}' | grep '^ic-fetch-' | grep -v '^ic-fetch-token-' || true
}

APPLY=0
UNTIL=""
ARGS=()
for argument in "$@"; do
    case "$argument" in
        --apply) APPLY=1 ;;
        --until=*) UNTIL="${argument#--until=}"; ARGS+=("$argument") ;;
        *) ARGS+=("$argument") ;;
    esac
done

if [ "$APPLY" -eq 0 ]; then
    run_chronicle "${ARGS[@]}"
    exit 0
fi

if [ -z "$UNTIL" ]; then
    echo "--apply needs an explicit --until=<cut-off>, e.g. --until=2026-11-30T23:00:00Z." >&2
    exit 1
fi
UNTIL_EPOCH=$(date -d "$UNTIL" +%s)
EARLY_SECONDS=$(( UNTIL_EPOCH - $(date +%s) ))
if [ "$EARLY_SECONDS" -gt "$MAX_EARLY_SECONDS" ]; then
    echo "The cut-off $UNTIL is more than an hour away: start this closer to it." >&2
    exit 1
fi

echo "This writes the Chronicle with data up to $UNTIL ($(date -u -d "@$UNTIL_EPOCH" '+%F %T') UTC) and holds the fills back while it runs."
read -r -p "Type APPLY to write it to production: " answer
if [ "$answer" != "APPLY" ]; then
    echo "Nothing written."
    exit 1
fi

if [ "$EARLY_SECONDS" -gt 0 ]; then
    echo "Waiting ${EARLY_SECONDS}s for the cut-off."
    sleep "$EARLY_SECONDS"
fi

touch "$FILL_PAUSE_FILE"
trap 'rm -f "$FILL_PAUSE_FILE"; echo "Fills released."' EXIT
echo "Fills held back ($FILL_PAUSE_FILE)."

sleep "$SETTLE_SECONDS"
while [ -n "$(running_fills)" ]; do
    echo "Waiting for $(running_fills | tr '\n' ' ')"
    touch "$FILL_PAUSE_FILE"
    sleep 15
done

touch "$FILL_PAUSE_FILE"
echo "No fill running, building the Chronicle at $(date -u '+%F %T') UTC."
run_chronicle --apply "${ARGS[@]}"
