#!/usr/bin/env bash
##########################################################################################
#                     This file is part of the gge-tracker project.                      #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors                #
##########################################################################################
#
# Creates an empty, current schema for every server servers.xml provisions, for a stack that
# collects its own data instead of loading the fixture. The schema is database/schema/, plus every
# migration. A database that already exists is left alone, so it can be run again after adding
# a server to servers.xml.
#
#   docker compose up -d postgres clickhouse
#   ./database/init-empty.sh            # every server of servers.xml
#   ./database/init-empty.sh FR1 DE1    # those, plus the shared global and logs databases
#
set -euo pipefail
cd "$(dirname "$0")"

SCHEMA_DIR="./schema"
SERVERS_FILE="${SERVERS_FILE:-../gge-tracker-backend-api/config/servers.xml}"
ENV_FILE="${ENV_FILE:-../.env}"
PG_CONTAINER="${PG_CONTAINER:-postgres-container}"
CH_CONTAINER="${CH_CONTAINER:-clickhouse}"

[ -d "$SCHEMA_DIR" ] || { echo "  [error] no schema at ${SCHEMA_DIR}" >&2; exit 1; }
[ -f "$SERVERS_FILE" ] || { echo "  [error] ${SERVERS_FILE} is missing - run gge-tracker-tools/dev-setup.sh first" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "  [error] ${ENV_FILE} is missing" >&2; exit 1; }
command -v python3 >/dev/null || { echo "  [error] python3 is needed to read ${SERVERS_FILE}" >&2; exit 1; }

env_value() {
  local line
  line="$(grep -m1 -E "^${1}=" "$ENV_FILE" || true)"
  line="${line#*=}"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

SQL_USER="$(env_value SQL_USER)"
SQL_PASSWORD="$(env_value SQL_PASSWORD)"
CLICKHOUSE_USER="$(env_value CLICKHOUSE_USER)"
CLICKHOUSE_PASSWORD="$(env_value CLICKHOUSE_PASSWORD)"

log() { echo "  $*"; }
psql_as() { docker exec -i -e PGPASSWORD="$SQL_PASSWORD" "$PG_CONTAINER" psql -U "$SQL_USER" "$@"; }
ch_client() { docker exec -i "$CH_CONTAINER" clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" "$@"; }

# shellcheck source=migrations/apply-migrations.sh
source ./migrations/apply-migrations.sh

# "<kind> <sql database> <olap database>" for every provisioned server, as ServersCatalog.isProvisioned reads it
provisioned_databases() {
  python3 - "$SERVERS_FILE" "$@" <<'PY'
import sys
import xml.etree.ElementTree as ET
wanted = set(sys.argv[2:])
seen = set()
for server in ET.parse(sys.argv[1]).getroot().iter('server'):
    kind = (server.findtext('kind') or '').strip()
    if wanted and kind != 'global' and (server.findtext('name') or '').strip() not in wanted:
        continue
    sql = (server.findtext('databases/sql') or '').strip()
    olap = (server.findtext('databases/olap') or '').strip()
    if kind == 'internal' or not sql or (sql, olap) in seen:
        continue
    seen.add((sql, olap))
    print(kind, sql, olap)
PY
}

create_postgres() {  # <database> <server|global>
  local exists tables
  exists="$(psql_as -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$1'")"
  if [ "$exists" = 1 ]; then
    # The postgres image creates SQL_DATABASE empty on its first start
    tables="$(psql_as -d "$1" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
    if [ "$tables" != 0 ]; then
      log "postgres ${1}: exists, left alone"
      return
    fi
  else
    psql_as -d postgres -q -c "CREATE DATABASE \"$1\";"
  fi
  psql_as -d "$1" -q -v ON_ERROR_STOP=1 -f - < "$SCHEMA_DIR/postgres/$2-pre.sql" >/dev/null
  psql_as -d "$1" -q -v ON_ERROR_STOP=1 -f - < "$SCHEMA_DIR/postgres/$2-post.sql" >/dev/null
  apply_postgres_migrations "$1"
  log "postgres ${1}: created"
}

create_clickhouse() {  # <database> <template> <database name the template uses>
  if [ "$(ch_client --query "SELECT count() FROM system.databases WHERE name = '$1'")" != 0 ]; then
    log "clickhouse ${1}: exists, left alone"
    return
  fi
  sed -e "s/\`$3\`/\`$1\`/g" -e "s/ $3\./ $1./g" "$SCHEMA_DIR/clickhouse/$2.sql" | ch_client --multiquery
  apply_clickhouse_migrations "$1"
  log "clickhouse ${1}: created"
}

until docker exec "$PG_CONTAINER" pg_isready -U "$SQL_USER" >/dev/null 2>&1; do sleep 2; done
until ch_client --query "SELECT 1" >/dev/null 2>&1; do sleep 2; done

# fd 3, because docker exec -i would read the rest of the list from stdin
while read -r kind sql olap <&3; do
  if [ "$kind" = global ]; then
    create_postgres "$sql" global
    create_clickhouse "$olap" global ggetracker_global
  else
    create_postgres "$sql" server
    [ -n "$olap" ] && create_clickhouse "$olap" server empire_ranking
  fi
done 3< <(provisioned_databases "$@")
create_clickhouse logs logs logs

log "done"
