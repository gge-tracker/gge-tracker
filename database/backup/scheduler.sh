#!/usr/bin/env bash
set -uo pipefail

BACKUP_AT="${BACKUP_AT:-03:15}"

seconds_until_next_run() {
  local now next
  now=$(date -u +%s)
  next=$(date -u -d "today ${BACKUP_AT}" +%s)
  if (( next <= now )); then
    next=$(date -u -d "tomorrow ${BACKUP_AT}" +%s)
  fi
  echo $(( next - now ))
}

if ! date -u -d "today ${BACKUP_AT}" >/dev/null 2>&1; then
  echo "{\"level\":\"error\",\"event\":\"db_backup_schedule\",\"msg\":\"BACKUP_AT must be HH:MM (UTC)\"}"
  exit 1
fi

while true; do
  delay=$(seconds_until_next_run)
  echo "{\"level\":\"info\",\"event\":\"db_backup_schedule\",\"next_run_utc\":\"$(date -u -d "@$(( $(date -u +%s) + delay ))" +%FT%TZ)\"}"
  sleep "${delay}" &
  wait $!
  /app/backup.sh
done
