#/bin/sh
#                                   __                        __
#    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
#   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
#  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
#  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
# /_____//_____/      \/                            \/     \/     \/    \/
#
#  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
#

BASE_SCRIPT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
SERVER="$1"

. "$BASE_SCRIPT_DIR/scripts/lib/servers.sh"

load_server_config "$SERVER"
LOG_SUFFIX=$SERVER

script -q -c "docker run -it --rm --network backend --env-file=$BASE_SCRIPT_DIR/.env \
    --name ic-storm-update-$SERVER \
    -e ID_SERVER=$ID_SERVER \
    -e PG_DB=$PG_DB \
    -e LOG_SUFFIX=$LOG_SUFFIX \
    -e CONNECTION_LIMIT=$CONNECTION_LIMIT \
    --memory="300m" \
    --memory-swap="300m" \
    --cpus="0.1" \
    gge-tracker-internal-scraping dist/storm-update.js" /dev/null
