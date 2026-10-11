#/bin/sh
#                                   __                        __
#    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
#   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
#  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
#  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
# /_____//_____/      \/                            \/     \/     \/    \/
#
#  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
#


BASE_SCRIPT_DIR="$(cd "$(dirname "$0")/.."; pwd)"

. "$BASE_SCRIPT_DIR/scripts/lib/servers.sh"

docker run --rm --network backend --env-file=$BASE_SCRIPT_DIR/.env \
    --name ic-loot-reset-check \
    -v "$SERVERS_CONFIG_DIR:/app/config:ro" \
    -e LOOT_RESET_CHECK_DAYS="${LOOT_RESET_CHECK_DAYS:-15}" \
    --cpus="0.5" \
    gge-tracker-internal-scraping dist/loot-reset-check.js
