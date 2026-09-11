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

OUTER_REALMS_SERVER="ORREALTIME"
load_server_config "$OUTER_REALMS_SERVER" TARGET_
TARGET_LOG_SUFFIX="$OUTER_REALMS_SERVER"

exec docker run --rm --init --network backend --env-file=$BASE_SCRIPT_DIR/.env \
    --name ic-fetch-token-$SERVER \
    -e ID_SERVER=$ID_SERVER \
    -e PG_DB=$PG_DB \
    -e MYSQL_DB=$MYSQL_DB \
    -e CLICKHOUSE_DB=$CLICKHOUSE_DB \
    -e LOG_SUFFIX=$LOG_SUFFIX \
    -e CONNECTION_LIMIT=$CONNECTION_LIMIT \
    -e TARGET_ID_SERVER=$TARGET_ID_SERVER \
    -e TARGET_PG_DB=$TARGET_PG_DB \
    -e TARGET_MYSQL_DB=$TARGET_MYSQL_DB \
    -e TARGET_CLICKHOUSE_DB=$TARGET_CLICKHOUSE_DB \
    -e TARGET_LOG_SUFFIX=$TARGET_LOG_SUFFIX \
    -e TARGET_CONNECTION_LIMIT=$TARGET_CONNECTION_LIMIT \
    --cpus="0.5" \
    gge-tracker-internal-scraping dist/outer-realms-token-scrapper.js
