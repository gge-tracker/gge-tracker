#!/bin/sh
#
# Grafana user provisioner
#
# Grafana OSS cannot provision users/permissions from config files, so this
# one-shot script creates the named community accounts via the HTTP API once
# Grafana is up. It is idempotent: safe to re-run on every container restart
#
set -eu

GF_URL="${GF_URL:-http://grafana:3000}"
AUTH="${GF_USERNAME}:${GF_PASSWORD}"

api() {
  _method="$1"; _path="$2"; _body="${3:-}"
  if [ -n "$_body" ]; then
    curl -fsS -u "$AUTH" -X "$_method" \
      -H 'Content-Type: application/json' \
      -d "$_body" "${GF_URL}${_path}"
  else
    curl -fsS -u "$AUTH" -X "$_method" "${GF_URL}${_path}"
  fi
}

echo "[provision] waiting for Grafana at ${GF_URL} ..."
until curl -fsS "${GF_URL}/api/health" >/dev/null 2>&1; do
  sleep 2
done
echo "[provision] Grafana is up."

ensure_user() {
  _login="$1"; _password="$2"; _email="$3"
  [ -n "$_email" ] || _email="${_login}@localhost"

  _uid=$(api GET "/api/users/lookup?loginOrEmail=${_login}" 2>/dev/null | jq -r '.id // empty' || true)

  if [ -z "$_uid" ]; then
    echo "[provision] creating user '${_login}'" >&2
    _payload=$(jq -n --arg n "$_login" --arg l "$_login" --arg e "$_email" --arg p "$_password" \
      '{name:$n, login:$l, email:$e, password:$p}')
    _uid=$(api POST "/api/admin/users" "$_payload" | jq -r '.id')
  else
    echo "[provision] user '${_login}' already exists (id ${_uid})" >&2
  fi

  api PATCH "/api/org/users/${_uid}" '{"role":"Viewer"}' >/dev/null
  echo "$_uid"
}

folder_uid() {
  api GET "/api/folders" | jq -r --arg t "$1" '.[] | select(.title==$t) | .uid' | head -n1
}

ADMIN_VIEWER_ID=$(ensure_user "$GF_ADMIN_VIEWER_USER" "$GF_ADMIN_VIEWER_PASSWORD" "${GF_ADMIN_VIEWER_EMAIL:-}")
MOD_VIEWER_ID=$(ensure_user "$GF_MOD_VIEWER_USER" "$GF_MOD_VIEWER_PASSWORD" "${GF_MOD_VIEWER_EMAIL:-}")

PARTNER_VIEWER_ID=""
if [ -n "${GF_PARTNER_VIEWER_USER:-}" ]; then
  PARTNER_VIEWER_ID=$(ensure_user "$GF_PARTNER_VIEWER_USER" "${GF_PARTNER_VIEWER_PASSWORD:?GF_PARTNER_VIEWER_PASSWORD is required when GF_PARTNER_VIEWER_USER is set}" "${GF_PARTNER_VIEWER_EMAIL:-}")
else
  echo "[provision] GF_PARTNER_VIEWER_USER is not set, skipping the partner account" >&2
fi

OVERVIEW_FOLDER=""
SCRAPING_FOLDER=""
PLATFORM_FOLDER=""
PARTNER_FOLDER=""
_tries=0
while [ "$_tries" -lt 30 ]; do
  OVERVIEW_FOLDER=$(folder_uid "Overview")
  SCRAPING_FOLDER=$(folder_uid "Scraping")
  PLATFORM_FOLDER=$(folder_uid "Platform")
  PARTNER_FOLDER=$(folder_uid "Partner")
  [ -n "$OVERVIEW_FOLDER" ] && [ -n "$SCRAPING_FOLDER" ] && [ -n "$PLATFORM_FOLDER" ] && [ -n "$PARTNER_FOLDER" ] && break
  _tries=$((_tries + 1))
  sleep 2
done

if [ -z "$OVERVIEW_FOLDER" ] || [ -z "$SCRAPING_FOLDER" ] || [ -z "$PLATFORM_FOLDER" ] || [ -z "$PARTNER_FOLDER" ]; then
  echo "[provision] ERROR: could not resolve the dashboard folder uids (Overview='${OVERVIEW_FOLDER}' Scraping='${SCRAPING_FOLDER}' Platform='${PLATFORM_FOLDER}' Partner='${PARTNER_FOLDER}')" >&2
  exit 1
fi

echo "[provision] Overview=${OVERVIEW_FOLDER}  Scraping=${SCRAPING_FOLDER}  Platform=${PLATFORM_FOLDER}  Partner=${PARTNER_FOLDER}"

viewers() {
  jq -n --argjson ids "$1" '{items: [$ids[] | {userId: ., permission: 1}]}'
}

# Platform carries the host, the containers, the CDN and the raw request log, so it stays admin-only
PLATFORM_IDS="[${ADMIN_VIEWER_ID}]"
SHARED_IDS="[${ADMIN_VIEWER_ID},${MOD_VIEWER_ID}]"
PARTNER_IDS="[${ADMIN_VIEWER_ID}]"
PARTNER_SUFFIX=""
if [ -n "$PARTNER_VIEWER_ID" ]; then
  SHARED_IDS="[${ADMIN_VIEWER_ID},${MOD_VIEWER_ID},${PARTNER_VIEWER_ID}]"
  PARTNER_IDS="[${ADMIN_VIEWER_ID},${PARTNER_VIEWER_ID}]"
  PARTNER_SUFFIX=" + partner viewer"
fi

api POST "/api/folders/${PLATFORM_FOLDER}/permissions" "$(viewers "$PLATFORM_IDS")" >/dev/null
echo "[provision] Platform folder permissions set (admin viewer)."
api POST "/api/folders/${OVERVIEW_FOLDER}/permissions" "$(viewers "$SHARED_IDS")" >/dev/null
echo "[provision] Overview folder permissions set (admin viewer + mod viewer${PARTNER_SUFFIX})."
api POST "/api/folders/${SCRAPING_FOLDER}/permissions" "$(viewers "$SHARED_IDS")" >/dev/null
echo "[provision] Scraping folder permissions set (admin viewer + mod viewer${PARTNER_SUFFIX})."
api POST "/api/folders/${PARTNER_FOLDER}/permissions" "$(viewers "$PARTNER_IDS")" >/dev/null
echo "[provision] Partner folder permissions set (admin viewer${PARTNER_SUFFIX})."

echo "[provision] done."
