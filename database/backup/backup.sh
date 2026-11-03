#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${CLICKHOUSE_USER:?}" "${CLICKHOUSE_PASSWORD:?}"
export PGDATABASE="${PGDATABASE:-postgres}"

BACKUP_ROOT=/backups
WORK_DIR="${BACKUP_ROOT}/.work"
PG_ARCHIVE=gge-tracker-postgres.tar.zst
CH_ARCHIVE=gge-tracker-clickhouse.tar.zst

CH_SERVER_DIR=/var/lib/clickhouse/backups
CH_LOCAL_DIR=/clickhouse-backups
CH_PREFIX=gge-tracker-clickhouse-
CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://clickhouse:8123}"
CH_BANDWIDTH_MB="${CLICKHOUSE_BACKUP_BANDWIDTH_MB:-40}"
CH_THREADS="${CLICKHOUSE_BACKUP_THREADS:-2}"
CH_TIMEOUT_S="${CLICKHOUSE_BACKUP_TIMEOUT_S:-14400}"
COPY_BANDWIDTH_MB="${COPY_BANDWIDTH_MB:-60}"
PG_ZSTD_LEVEL="${PG_ZSTD_LEVEL:-3}"
MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-80}"
OWNER="${BACKUP_OWNER:-1000:1000}"

run_started=$(date -u +%s)
step=start
ch_name=""

json_escape() {
  local text=${1//\\/\\\\}
  text=${text//\"/\\\"}
  text=${text//$'\n'/ }
  text=${text//$'\t'/ }
  printf '%s' "${text:0:500}"
}

log() {
  local level=$1
  shift
  printf '{"level":"%s","event":"db_backup",%s}\n' "${level}" "$*"
}

seconds_since() {
  echo $(( $(date -u +%s) - $1 ))
}

remove_clickhouse_archives() {
  find "${CH_LOCAL_DIR}" -maxdepth 1 -type f -name "${CH_PREFIX}*" -delete
}

fail() {
  trap - ERR
  log error "\"status\":\"failed\",\"step\":\"${step}\",\"reason\":\"$(json_escape "$1")\",\"duration_s\":$(seconds_since "${run_started}")"
  rm -rf "${WORK_DIR}"
  remove_clickhouse_archives || true
  exit 1
}
trap 'fail "command failed (exit $?) at line ${LINENO}: ${BASH_COMMAND}"' ERR

clickhouse_query() {
  local user=${CLICKHOUSE_USER//\\/\\\\} password=${CLICKHOUSE_PASSWORD//\\/\\\\}
  user=${user//\"/\\\"}
  password=${password//\"/\\\"}
  curl -sS --fail-with-body --max-time 60 \
    -K <(printf 'user = "%s:%s"\n' "${user}" "${password}") \
    --data-binary "$1" "${CLICKHOUSE_URL}/"
}

check_free_space() {
  step=disk_space
  local free_gb
  free_gb=$(( $(df -Pk "${BACKUP_ROOT}" | awk 'NR == 2 { print $4 }') / 1024 / 1024 ))
  if (( free_gb < MIN_FREE_GB )); then
    fail "only ${free_gb} GB free on the backup disk, ${MIN_FREE_GB} GB required"
  fi
}

prepare() {
  step=prepare
  if [[ ! -d ${CH_LOCAL_DIR} ]]; then
    fail "${CH_LOCAL_DIR} is not mounted: the backups subfolder of the ClickHouse volume must exist"
  fi
  rm -rf "${WORK_DIR}"
  remove_clickhouse_archives
  mkdir -p "${WORK_DIR}/postgres"
  chown "${OWNER}" "${BACKUP_ROOT}"
  chmod 0700 "${BACKUP_ROOT}"
}

dump_postgres() {
  step=postgres
  local started database
  local -a databases
  started=$(date -u +%s)
  mapfile -t databases < <(psql -XAtc "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname")
  if (( ${#databases[@]} == 0 )); then
    fail "no Postgres database found"
  fi

  nice -n 10 pg_dumpall --globals-only --file="${WORK_DIR}/postgres/globals.sql"
  # One database at a time keeps Postgres on a single backend; the archive compresses once, at the end.
  for database in "${databases[@]}"; do
    nice -n 10 pg_dump --format=custom --compress=0 --dbname="${database}" --file="${WORK_DIR}/postgres/${database}.dump"
  done

  step=postgres_archive
  tar -C "${WORK_DIR}/postgres" -cf - . | nice -n 10 zstd -q -T1 "-${PG_ZSTD_LEVEL}" -o "${WORK_DIR}/${PG_ARCHIVE}"
  rm -rf "${WORK_DIR}/postgres"
  pg_checksum=$(nice -n 10 sha256sum < "${WORK_DIR}/${PG_ARCHIVE}" | cut -d' ' -f1)

  pg_databases=${#databases[@]}
  pg_seconds=$(seconds_since "${started}")
}

backup_clickhouse() {
  step=clickhouse
  local started answer backup_id status deadline
  started=$(date -u +%s)
  deadline=$(( started + CH_TIMEOUT_S ))
  ch_name="${CH_PREFIX}$(date -u +%Y%m%dT%H%M%SZ).tar.zst"

  if ! answer=$(clickhouse_query "BACKUP ALL EXCEPT DATABASES system, information_schema, INFORMATION_SCHEMA TO File('${CH_SERVER_DIR}/${ch_name}') SETTINGS backup_threads = ${CH_THREADS}, max_backup_bandwidth = $(( CH_BANDWIDTH_MB * 1048576 )) ASYNC FORMAT TSV" 2>&1); then
    fail "ClickHouse refused the backup: ${answer}"
  fi
  backup_id=${answer%%$'\t'*}
  if [[ ! ${backup_id} =~ ^[0-9a-f-]{36}$ ]]; then
    fail "ClickHouse did not start the backup: ${answer}"
  fi

  while true; do
    if ! status=$(clickhouse_query "SELECT status FROM system.backups WHERE id = '${backup_id}' FORMAT TSV" 2>&1); then
      fail "ClickHouse stopped answering during the backup: ${status}"
    fi
    if [[ ${status} != CREATING_BACKUP ]]; then
      break
    fi
    if (( $(date -u +%s) > deadline )); then
      fail "ClickHouse backup still running after ${CH_TIMEOUT_S}s"
    fi
    sleep 15
  done
  if [[ ${status} != BACKUP_CREATED ]]; then
    fail "ClickHouse backup ended ${status}: $(clickhouse_query "SELECT substring(error, 1, 400) FROM system.backups WHERE id = '${backup_id}' FORMAT TSV")"
  fi

  ch_files=$(clickhouse_query "SELECT num_files FROM system.backups WHERE id = '${backup_id}' FORMAT TSV")
  ch_seconds=$(seconds_since "${started}")
}

copy_clickhouse_archive() {
  step=clickhouse_copy
  local source="${CH_LOCAL_DIR}/${ch_name}"
  if [[ ! -f ${source} ]]; then
    fail "ClickHouse reported ${ch_name} but it is not in ${CH_LOCAL_DIR}"
  fi
  # Throttled, and hashed on the way
  ch_checksum=$(pv -q -L "${COPY_BANDWIDTH_MB}m" < "${source}" | tee "${WORK_DIR}/${CH_ARCHIVE}" | sha256sum | cut -d' ' -f1)
  rm -f "${source}"
}

verify_archive() {
  local archive=$1 required_member=$2
  step="verify_$(basename "${archive}")"
  nice -n 10 tar -I 'zstd -q -T1' -tf "${archive}" > "${WORK_DIR}/members"
  if ! grep -qxF -- "${required_member}" "${WORK_DIR}/members"; then
    fail "$(basename "${archive}") does not contain ${required_member}"
  fi
}

publish() {
  local name=$1 checksum=$2
  step="publish_${name}"
  printf '%s  %s\n' "${checksum}" "${name}" > "${WORK_DIR}/${name}.sha256"
  chown "${OWNER}" "${WORK_DIR}/${name}" "${WORK_DIR}/${name}.sha256"
  chmod 0600 "${WORK_DIR}/${name}" "${WORK_DIR}/${name}.sha256"
  mv -f "${WORK_DIR}/${name}.sha256" "${BACKUP_ROOT}/${name}.sha256"
  mv -f "${WORK_DIR}/${name}" "${BACKUP_ROOT}/${name}"
}

exec 9> /tmp/db-backup.lock
if ! flock -n 9; then
  log warn '"status":"skipped","reason":"another backup is running"'
  exit 0
fi

log info '"status":"started"'
check_free_space
prepare
dump_postgres
backup_clickhouse
copy_clickhouse_archive
verify_archive "${WORK_DIR}/${PG_ARCHIVE}" ./globals.sql
verify_archive "${WORK_DIR}/${CH_ARCHIVE}" .backup
publish "${PG_ARCHIVE}" "${pg_checksum}"
publish "${CH_ARCHIVE}" "${ch_checksum}"
rm -rf "${WORK_DIR}"

log info "\"status\":\"success\",\"duration_s\":$(seconds_since "${run_started}"),\"postgres_databases\":${pg_databases},\"postgres_seconds\":${pg_seconds},\"postgres_bytes\":$(stat -c %s "${BACKUP_ROOT}/${PG_ARCHIVE}"),\"clickhouse_files\":${ch_files},\"clickhouse_seconds\":${ch_seconds},\"clickhouse_bytes\":$(stat -c %s "${BACKUP_ROOT}/${CH_ARCHIVE}")"
