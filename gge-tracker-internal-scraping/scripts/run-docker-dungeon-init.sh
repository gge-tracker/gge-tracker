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
CONF_FILE="$BASE_SCRIPT_DIR/config/servers.conf"
SERVER="$1"

get_conf_value() {
    local section=$1
    local key=$2
    awk -F= -v section="[$section]" -v key="$key" '
        $0 == section {in_section=1; next}
        /^\[/ {in_section=0}
        in_section && $1 == key {gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}
    ' "$CONF_FILE"
}

ID_SERVER=$(get_conf_value "$SERVER" "zone")
PG_DB=$(get_conf_value "$SERVER" "sql")
LOG_SUFFIX=$SERVER
CONNECTION_LIMIT=$(get_conf_value "$SERVER" "limit")

docker run -it --rm --network backend --env-file=$BASE_SCRIPT_DIR/.env \
    --name ic-dungeon-init-$SERVER \
    -e ID_SERVER=$ID_SERVER \
    -e PG_DB=$PG_DB \
    -e LOG_SUFFIX=$LOG_SUFFIX \
    -e CONNECTION_LIMIT=$CONNECTION_LIMIT \
    -v $BASE_SCRIPT_DIR/logs:/app/logs \
    gge-tracker-internal-scraping dist/dungeon-init.js
