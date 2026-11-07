#!/bin/sh
#
# Creates the ClickHouse user Grafana queries with: SELECT only (helper)
#
set -eu

[ -f .env ] && set -a && . ./.env && set +a
: "${GRAFANA_CLICKHOUSE_USER:?set GRAFANA_CLICKHOUSE_USER in .env}"
: "${GRAFANA_CLICKHOUSE_PASSWORD:?set GRAFANA_CLICKHOUSE_PASSWORD in .env}"
CONTAINER="${CLICKHOUSE_CONTAINER:-clickhouse}"

case "$GRAFANA_CLICKHOUSE_USER" in
  *[!a-z0-9_]*) echo "GRAFANA_CLICKHOUSE_USER must be lowercase letters, digits or _" >&2; exit 1 ;;
esac

case "$GRAFANA_CLICKHOUSE_PASSWORD" in
  *\'*|*\\*) echo "GRAFANA_CLICKHOUSE_PASSWORD must not contain a quote or a backslash" >&2; exit 1 ;;
esac

docker exec -i -e CLICKHOUSE_ADMIN_USER="${CLICKHOUSE_ADMIN_USER:-}" -e CLICKHOUSE_ADMIN_PASSWORD="${CLICKHOUSE_ADMIN_PASSWORD:-}" \
  "$CONTAINER" sh -c 'exec clickhouse-client --multiquery \
    --user "${CLICKHOUSE_ADMIN_USER:-${CLICKHOUSE_USER:-default}}" \
    --password "${CLICKHOUSE_ADMIN_PASSWORD:-${CLICKHOUSE_PASSWORD:-}}"' <<SQL
CREATE USER IF NOT EXISTS ${GRAFANA_CLICKHOUSE_USER} IDENTIFIED WITH sha256_password BY '${GRAFANA_CLICKHOUSE_PASSWORD}';
ALTER USER ${GRAFANA_CLICKHOUSE_USER} IDENTIFIED WITH sha256_password BY '${GRAFANA_CLICKHOUSE_PASSWORD}';
REVOKE ALL ON *.* FROM ${GRAFANA_CLICKHOUSE_USER};
GRANT SELECT ON *.* TO ${GRAFANA_CLICKHOUSE_USER};
SQL
echo "ClickHouse user ${GRAFANA_CLICKHOUSE_USER} has SELECT only. Restart grafana to use it."
