#!/usr/bin/env bash
##########################################################################################
#                     This file is part of the gge-tracker project.                      #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors                #
##########################################################################################
#
# Generates the test fixture and loads it into the local dev stack: FR1 and INT1 of
# servers.example.xml, from a fixed seed and a fixed date, so every run and every machine get
# byte-identical data. Its databases are dropped and recreated every time.
#
# FIXTURE_DIR loads a set generate.sh already wrote instead. Moving FIXTURE_ANCHOR (the instant
# the data ends) or any other FIXTURE_ setting changes every answer: re-record the snapshot after.
#
set -euo pipefail
cd "$(dirname "$0")"

FIXTURE_SERVERS="${FIXTURE_SERVERS:-FR1,INT1}"
FIXTURE_PLAYERS="${FIXTURE_PLAYERS:-FR1=2000,INT1=300}"
FIXTURE_DAYS="${FIXTURE_DAYS:-14}"
FIXTURE_SEED="${FIXTURE_SEED:-1}"
FIXTURE_ANCHOR="${FIXTURE_ANCHOR:-2026-11-15T12:00:00Z}"

if [ -z "${FIXTURE_DIR:-}" ]; then
  source ./run-generator.sh
  run_generator fixture "$(pwd)/../../gge-tracker-backend-api/config/servers.example.xml" \
    --mode full --servers "$FIXTURE_SERVERS" --players "$FIXTURE_PLAYERS" --days "$FIXTURE_DAYS" \
    --seed "$FIXTURE_SEED" --anchor "$FIXTURE_ANCHOR"
fi
DATA_DIR="${FIXTURE_DIR:-./generated/fixture}"
PG_CONTAINER="${PG_CONTAINER:-postgres-container}"
CH_CONTAINER="${CH_CONTAINER:-clickhouse}"
REDIS_CONTAINER="${REDIS_CONTAINER:-redis-container}"
MOCKED_REDIS_DB="${MOCKED_REDIS_DB:-1}"
GLOBAL_DB="${GLOBAL_DB:-empire-ranking-global}"
BACKEND_CONTAINERS="${BACKEND_CONTAINERS-backend-container backend-container-mocked}"

[ -d "$DATA_DIR" ] || { echo "  [error] no generated set at ${DATA_DIR}" >&2; exit 1; }

ENV_FILE="${ENV_FILE:-../../.env}"
[ -f "$ENV_FILE" ] || { echo "  [error] ${ENV_FILE} is missing" >&2; exit 1; }

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
[ -n "$SQL_USER" ] || { echo "  [error] SQL_USER missing from ${ENV_FILE}" >&2; exit 1; }

log() { echo "  $*"; }

source ../migrations/apply-migrations.sh

wait_for() {
  local container="$1"; shift
  local tries=60
  until docker exec "$container" "$@" >/dev/null 2>&1; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || { echo "  [error] ${container} never became ready" >&2; exit 1; }
    sleep 2
  done
}

psql_as() { docker exec -i -e PGPASSWORD="$SQL_PASSWORD" "$PG_CONTAINER" psql -U "$SQL_USER" "$@"; }
ch_client() { docker exec -i "$CH_CONTAINER" clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" "$@"; }

reset_sequences() {
  psql_as -d "$1" -q -v ON_ERROR_STOP=1 -f - <<'SQL'
DO $$
DECLARE owned record;
BEGIN
  FOR owned IN
    SELECT sequence.oid::regclass AS seq, owner.oid::regclass AS tbl, col.attname AS col
    FROM pg_class sequence
    JOIN pg_depend dep ON dep.objid = sequence.oid AND dep.classid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
    JOIN pg_class owner ON owner.oid = dep.refobjid
    JOIN pg_attribute col ON col.attrelid = owner.oid AND col.attnum = dep.refobjsubid
    WHERE sequence.relkind = 'S'
  LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %s), 0) + 1, false)', owned.seq, owned.col, owned.tbl);
  END LOOP;
END $$;
SQL
}

load_postgres() {
  [ -d "$DATA_DIR/postgres" ] || return 0
  wait_for "$PG_CONTAINER" pg_isready -U "$SQL_USER"

  for dir in "$DATA_DIR"/postgres/*/; do
    local db; db="$(basename "$dir")"
    log "postgres ${db}"
    psql_as -d postgres -q -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE);"
    psql_as -d postgres -q -c "CREATE DATABASE \"${db}\";"

    zcat "$dir/000-schema-pre.sql.gz" | psql_as -d "$db" -q -v ON_ERROR_STOP=1 -f -

    for csv in "$dir"/*.csv.gz; do
      [ -e "$csv" ] || continue
      local table; table="$(basename "$csv" .csv.gz)"
      zcat "$csv" | psql_as -d "$db" -q -v ON_ERROR_STOP=1 \
        -c "\\copy \"${table}\" FROM STDIN WITH (FORMAT csv)"
      log "  ${table}"
    done

    zcat "$dir/999-schema-post.sql.gz" | psql_as -d "$db" -q -v ON_ERROR_STOP=1 -f -

    apply_postgres_migrations "$db"
    reset_sequences "$db"
    psql_as -d "$db" -q -c "ANALYZE;"
  done
}

merge_shared() {
  local dir="$DATA_DIR/shared"
  [ -f "$dir/target" ] || return 0
  local server region
  while read -r server region; do
    log "postgres ${GLOBAL_DB}: rows of ${server}"
    psql_as -d "$GLOBAL_DB" -q -v ON_ERROR_STOP=1 \
      -c "DELETE FROM global_players WHERE region = '${region}'" \
      -c "DELETE FROM global_ranking WHERE region = '${region}'" \
      -c "DELETE FROM mini_games WHERE server = '${server}'" < /dev/null
  done < "$dir/target"
  zcat "$dir/global_players.csv.gz" | psql_as -d "$GLOBAL_DB" -q -v ON_ERROR_STOP=1 -c "\\copy global_players FROM STDIN WITH (FORMAT csv)"
  zcat "$dir/global_ranking.csv.gz" | psql_as -d "$GLOBAL_DB" -q -v ON_ERROR_STOP=1 -c "\\copy global_ranking FROM STDIN WITH (FORMAT csv)"
  zcat "$dir/mini_games.csv.gz" | psql_as -d "$GLOBAL_DB" -q -v ON_ERROR_STOP=1 -c "\\copy mini_games (game_date, server, player_id, castle_id, position_x, position_y, nb_castles, skin_equipment_id, skin_equipment_name, gate_level, wall_level, keep_level, tower_level, castle_name, alliance_rank, honor, player_title_1, player_title_2, is_protection, level, legendary_level, created_at, might, fame, name) FROM STDIN WITH (FORMAT csv)"
  reset_sequences "$GLOBAL_DB"
}

load_clickhouse() {
  [ -d "$DATA_DIR/clickhouse" ] || return 0
  wait_for "$CH_CONTAINER" clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT 1"

  for dir in "$DATA_DIR"/clickhouse/*/; do
    local db; db="$(basename "$dir")"
    log "clickhouse ${db}"
    ch_client --query "DROP DATABASE IF EXISTS \`${db}\`"
    zcat "$dir/000-schema.sql.gz" | ch_client --multiquery

    for csv in "$dir"/*.csv.gz; do
      [ -e "$csv" ] || continue
      local table; table="$(basename "$csv" .csv.gz)"
      if [ -s "$csv" ] && [ "$(zcat "$csv" | head -c1 | wc -c)" -gt 0 ]; then
        zcat "$csv" | ch_client --query "INSERT INTO \`${db}\`.\`${table}\` FORMAT CSV"
      fi
      log "  ${table}"
    done

    apply_clickhouse_migrations "$db"
  done
}

echo
log "loading fixture from ${DATA_DIR}"
[ -f "$DATA_DIR/manifest.txt" ] && sed 's/^/    /' "$DATA_DIR/manifest.txt"
echo

load_postgres
merge_shared
load_clickhouse


if [ -n "$(docker ps -q -f name="^${REDIS_CONTAINER}$")" ]; then
  log "flushing the mocked backend's Redis cache (database ${MOCKED_REDIS_DB})"
  docker exec "$REDIS_CONTAINER" redis-cli -n "$MOCKED_REDIS_DB" FLUSHDB >/dev/null
fi

# The API opens a connection pool per database at startup. Loading the fixture drops and
# recreates those databases, which kills the pooled connections underneath it - and
# pg-pool does not recover: every later query on an affected pool waits out its full 10s
# connect timeout instead. That turns a 30-second test run into an hour, so if an API
# reading these databases is up, restart it
for container in $BACKEND_CONTAINERS; do
  [ -n "$(docker ps -q -f name="^${container}$")" ] || continue
  log "restarting ${container} so it reconnects to the new databases"
  docker restart "$container" >/dev/null
done

echo
log "fixture loaded"
