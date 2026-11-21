#!/usr/bin/env bash
##########################################################################################
#                     This file is part of the gge-tracker project.                      #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors                #
##########################################################################################
#
# Fills one server of servers.xml with generated data: invented players and alliances,
# castles on the map, hourly might, loot and glory history ending now, and the renames,
# moves and statistics that go with them. Same seed, same data.
#
#   docker compose up -d postgres clickhouse redis-server
#   ./database/fixtures/generate.sh FR1 [--players 2000] [--days 14] [--seed 1] [--anchor now]
#   ./database/fixtures/generate.sh DE1,PL1
#
# Generating FR1 or INT1 replaces the fixture the API tests run against;
# ./database/fixtures/load-fixtures.sh puts it back.
#
set -euo pipefail
cd "$(dirname "$0")"

SERVERS="${1:-}"
[ -n "$SERVERS" ] && [ "${SERVERS#-}" = "$SERVERS" ] || {
  echo "usage: $0 <SERVER[,SERVER...]> [--players 2000] [--days 14] [--seed 1] [--anchor now|ISO]" >&2
  exit 2
}
shift

CONFIG_DIR="$(cd ../../gge-tracker-backend-api/config && pwd)"
SERVERS_FILE="${SERVERS_FILE:-$CONFIG_DIR/servers.xml}"
[ -f "$SERVERS_FILE" ] || SERVERS_FILE="$CONFIG_DIR/servers.example.xml"
SET="${SERVERS//,/-}"
REDIS_CONTAINER="${REDIS_CONTAINER:-redis-container}"

source ./run-generator.sh
run_generator "$SET" "$SERVERS_FILE" --mode merge --servers "$SERVERS" "$@"

SERVERS_FILE="$SERVERS_FILE" ../init-empty.sh ${SERVERS//,/ }
FIXTURE_DIR="./generated/$SET" ./load-fixtures.sh

if [ -n "$(docker ps -q -f name="^${REDIS_CONTAINER}$")" ]; then
  for server in ${SERVERS//,/ }; do
    for database in 0 1; do
      docker exec "$REDIS_CONTAINER" redis-cli -n "$database" INCR "fill-version:${server}" >/dev/null
    done
  done
  echo "  cached answers for ${SERVERS} invalidated"
fi
