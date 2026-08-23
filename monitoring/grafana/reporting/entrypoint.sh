#!/bin/sh
# Cron wrapper for the weekly recap

set -eu

SCHEDULE="${RECAP_SCHEDULE:-0 9 * * 1}"

apk add --no-cache curl jq tzdata >/dev/null

mkdir -p /etc/crontabs
echo "$SCHEDULE sh /scripts/weekly-recap.sh >/proc/1/fd/1 2>&1" > /etc/crontabs/root

echo "[recap] scheduled '$SCHEDULE' (TZ=${TZ:-UTC})"

if [ "${RECAP_RUN_ON_START:-0}" = "1" ]; then
  sh /scripts/weekly-recap.sh || echo "[recap] startup run failed" >&2
fi

exec crond -f -l 8
