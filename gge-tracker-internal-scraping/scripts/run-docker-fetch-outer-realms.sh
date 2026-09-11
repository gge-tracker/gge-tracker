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
SERVER="$1"

. "$BASE_SCRIPT_DIR/scripts/lib/servers.sh"

load_server_config "$SERVER"
LOG_SUFFIX=$SERVER

docker run --rm --network backend --env-file=$BASE_SCRIPT_DIR/.env \
    --name ic-fetch-outer-realms \
    -e ID_SERVER=$ID_SERVER \
    -e PG_DB=$PG_DB \
    -e CLICKHOUSE_DB=$CLICKHOUSE_DB \
    -e LOG_SUFFIX=$LOG_SUFFIX \
    -e CONNECTION_LIMIT=$CONNECTION_LIMIT \
    --cpus="0.5" \
    gge-tracker-internal-scraping dist/fetch-and-save-outer-realms.js
