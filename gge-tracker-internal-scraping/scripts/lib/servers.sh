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
# Server lookup shared by every run-docker-*.sh script

SERVERS_CONFIG_DIR="${SERVERS_CONFIG_DIR:-$BASE_SCRIPT_DIR/../gge-tracker-backend-api/config}"
SERVERS_IMAGE="${SERVERS_IMAGE:-gge-tracker-internal-scraping}"

if [ ! -f "$SERVERS_CONFIG_DIR/servers.xml" ]; then
    echo "No servers.xml in $SERVERS_CONFIG_DIR. Set SERVERS_CONFIG_DIR to the folder holding it." >&2
    exit 1
fi
SERVERS_CONFIG_DIR="$(cd "$SERVERS_CONFIG_DIR"; pwd)"

# load_server_config <section|server> [PREFIX]
# Defines ID_SERVER, PG_DB, MYSQL_DB, CLICKHOUSE_DB, CONNECTION_LIMIT, DUNGEON, STORM,
# SERVER_SECTION and SERVER_NAME, each prefixed with PREFIX when one is given
load_server_config() {
    _section="$1"
    _prefix="$2"
    if ! _values=$(docker run --rm \
        -v "$SERVERS_CONFIG_DIR:/app/config:ro" \
        "$SERVERS_IMAGE" dist/servers-config.js "$_section" "$_prefix"); then
        echo "Could not read the configuration of '$_section' from $SERVERS_CONFIG_DIR/servers.xml" >&2
        exit 1
    fi
    eval "$_values"
    unset _section _prefix _values
}
