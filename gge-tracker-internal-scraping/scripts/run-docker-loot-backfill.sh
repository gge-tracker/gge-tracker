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
# Rebuilds stored weekly loot past 2^32 for every completed week, and raises loot_all_time to match.
#
#   run-docker-loot-backfill.sh [--servers=FR1,DE1] [--since=2026-01-01]          dry run, writes nothing
#   run-docker-loot-backfill.sh --apply [--servers=...] [--since=...]              dry run, confirmation, then writes
#   run-docker-loot-backfill.sh --rollback=/app/backups/<file>.json [--apply]      undoes one server from its backup

set -eu

BASE_SCRIPT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
. "$BASE_SCRIPT_DIR/scripts/lib/servers.sh"

BACKUP_DIR="${LOOT_BACKFILL_DIR:-$BASE_SCRIPT_DIR/backups/loot-backfill}"
LOCK_FILE="${LOOT_BACKFILL_LOCK:-/tmp/gge-tracker-loot-backfill.lock}"
mkdir -p "$BACKUP_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "Another loot backfill is running (lock $LOCK_FILE)." >&2
    exit 1
fi

run_backfill() {
    docker run --rm --network backend --env-file="$BASE_SCRIPT_DIR/.env" \
        --name ic-loot-backfill \
        -v "$SERVERS_CONFIG_DIR:/app/config:ro" \
        -v "$BACKUP_DIR:/app/backups" \
        --cpus="1" \
        "$SERVERS_IMAGE" dist/loot-backfill.js "$@"
}

APPLY=0
ARGS=()
for argument in "$@"; do
    if [ "$argument" = "--apply" ]; then APPLY=1; else ARGS+=("$argument"); fi
done

run_backfill "${ARGS[@]}"
[ "$APPLY" -eq 1 ] || exit 0

echo
echo "The dry run above is what --apply writes. Backups go to $BACKUP_DIR."
read -r -p "Type APPLY to write it to production: " answer
if [ "$answer" != "APPLY" ]; then
    echo "Nothing written."
    exit 1
fi
run_backfill --apply "${ARGS[@]}"
