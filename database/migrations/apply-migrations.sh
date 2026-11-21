#!/usr/bin/env bash
##########################################################################################
#                     This file is part of the gge-tracker project.                      #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors                #
##########################################################################################
#
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

apply_postgres_migrations() {  # <database>
  local migration
  for migration in "$MIGRATIONS_DIR"/*.postgres.sql; do
    [ -e "$migration" ] || continue
    psql_as -d "$1" -q -v ON_ERROR_STOP=1 -f - < "$migration"
  done
}

ch_migration() {  # <file> [clickhouse-client args...]
  local file="$MIGRATIONS_DIR/$1"; shift
  [ -f "$file" ] || return 0
  ch_client --multiquery "$@" < "$file"
}

ch_has_column() {  # <database> <table> <column>
  [ "$(ch_client --query "SELECT count() FROM system.columns WHERE database = '$1' AND table = '$2' AND name = '$3'")" != 0 ]
}

apply_clickhouse_migrations() {  # <database>
  local db="$1"
  case "$db" in
    ggetracker_global)
      ch_migration rift-raid.clickhouse.sql --database ggetracker_global
      ch_migration kingdoms-league.clickhouse.sql
      ch_migration store-offer-history.clickhouse.sql
      # Not rerunnable by itself: it rebuilds the table around a game column, so it runs only while that column is missing
      ch_has_column ggetracker_global store_offer_history game || ch_migration store-offer-history-game.clickhouse.sql
      ch_migration store-offer-snapshots.clickhouse.sql
      ch_migration year-chronicle.clickhouse.sql
      ;;
    logs)
      ch_migration api-keys-logs-partner.clickhouse.sql
      ch_migration logs-request-context.clickhouse.sql
      ch_migration logs-rate-limit.clickhouse.sql
      ch_migration logs-retention.clickhouse.sql
      ;;
    *)
      ch_migration player-glory-history.clickhouse.sql --database "$db"
      ;;
  esac
}
