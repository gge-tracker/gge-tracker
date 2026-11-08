#!/bin/sh
#
# Creates the ClickHouse user Grafana queries with: SELECT only (helper)
#
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
CONTAINER="${CLICKHOUSE_CONTAINER:-clickhouse}"
ADMIN_USERS_FILE=/etc/clickhouse-server/users.d/default-user.xml

env_value() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^(['\"])(.*)\1\$/\2/" || true
}

fail() {
  echo "$1" >&2
  exit 1
}

clickhouse_admin() {
  docker exec -i -e CLICKHOUSE_ADMIN_USER="$CLICKHOUSE_ADMIN_USER" -e CLICKHOUSE_ADMIN_PASSWORD="$CLICKHOUSE_ADMIN_PASSWORD" \
    "$CONTAINER" sh -c 'exec clickhouse-client --multiquery \
      --user "$CLICKHOUSE_ADMIN_USER" \
      --password "$CLICKHOUSE_ADMIN_PASSWORD" "$@"' sh "$@"
}

admin_can_manage_access() {
  clickhouse_admin --query "SHOW GRANTS" </dev/null | grep -qE 'ACCESS MANAGEMENT|CREATE USER|GRANT ALL ON'
}

set_access_management() {
  docker exec -u root "$CONTAINER" sed -i \
    "s|<access_management>[01]</access_management>|<access_management>$1</access_management>|" \
    "$ADMIN_USERS_FILE"
}

wait_for_access_management() {
  _tries=0
  until admin_can_manage_access; do
    _tries=$((_tries + 1))
    [ "$_tries" -lt 15 ] || fail "ClickHouse did not reload $ADMIN_USERS_FILE within 15s"
    sleep 1
  done
}

[ -f "$ENV_FILE" ] || fail "No env file at $ENV_FILE (set ENV_FILE to point elsewhere)"

GRAFANA_CLICKHOUSE_USER="$(env_value GRAFANA_CLICKHOUSE_USER)"
GRAFANA_CLICKHOUSE_PASSWORD="$(env_value GRAFANA_CLICKHOUSE_PASSWORD)"
CLICKHOUSE_ADMIN_USER="$(env_value CLICKHOUSE_USER)"
CLICKHOUSE_ADMIN_PASSWORD="$(env_value CLICKHOUSE_PASSWORD)"

[ -n "$GRAFANA_CLICKHOUSE_USER" ] || fail "Set GRAFANA_CLICKHOUSE_USER in $ENV_FILE"
[ -n "$GRAFANA_CLICKHOUSE_PASSWORD" ] || fail "Set GRAFANA_CLICKHOUSE_PASSWORD in $ENV_FILE"
[ -n "$CLICKHOUSE_ADMIN_USER" ] || fail "Set CLICKHOUSE_USER in $ENV_FILE"

case "$GRAFANA_CLICKHOUSE_USER" in
  *[!a-z0-9_]*) fail "GRAFANA_CLICKHOUSE_USER must be lowercase letters, digits or _" ;;
esac

case "$GRAFANA_CLICKHOUSE_PASSWORD" in
  *\'*|*\\*) fail "GRAFANA_CLICKHOUSE_PASSWORD must not contain a quote or a backslash" ;;
esac

# The script revokes everything from the reader
[ "$GRAFANA_CLICKHOUSE_USER" != "$CLICKHOUSE_ADMIN_USER" ] \
  || fail "GRAFANA_CLICKHOUSE_USER must differ from CLICKHOUSE_USER"
[ "$GRAFANA_CLICKHOUSE_USER" != "default" ] || fail "GRAFANA_CLICKHOUSE_USER must not be 'default'"

if ! admin_can_manage_access; then
  docker exec "$CONTAINER" grep -q '<access_management>0</access_management>' "$ADMIN_USERS_FILE" \
    || fail "$CLICKHOUSE_ADMIN_USER cannot create users and $ADMIN_USERS_FILE has no access_management to enable"
  # ClickHouse reloads users.d every few seconds
  trap 'set_access_management 0 && echo "Access management of $CLICKHOUSE_ADMIN_USER turned back off."' EXIT
  echo "Enabling access management for $CLICKHOUSE_ADMIN_USER..."
  set_access_management 1
  wait_for_access_management
fi

clickhouse_admin <<SQL
CREATE USER IF NOT EXISTS ${GRAFANA_CLICKHOUSE_USER} IDENTIFIED WITH sha256_password BY '${GRAFANA_CLICKHOUSE_PASSWORD}';
ALTER USER ${GRAFANA_CLICKHOUSE_USER} IDENTIFIED WITH sha256_password BY '${GRAFANA_CLICKHOUSE_PASSWORD}';
REVOKE ALL ON *.* FROM ${GRAFANA_CLICKHOUSE_USER};
GRANT SELECT ON *.* TO ${GRAFANA_CLICKHOUSE_USER};
SQL
echo "[OK] ClickHouse user ${GRAFANA_CLICKHOUSE_USER} created with SELECT grant"
