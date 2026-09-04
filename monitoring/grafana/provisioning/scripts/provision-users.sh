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

ADMIN_FOLDER=""
MOD_FOLDER=""
PARTNER_FOLDER=""
_tries=0
while [ "$_tries" -lt 30 ]; do
  ADMIN_FOLDER=$(folder_uid "Admin")
  MOD_FOLDER=$(folder_uid "Mod")
  PARTNER_FOLDER=$(folder_uid "Partner")
  [ -n "$ADMIN_FOLDER" ] && [ -n "$MOD_FOLDER" ] && [ -n "$PARTNER_FOLDER" ] && break
  _tries=$((_tries + 1))
  sleep 2
done

if [ -z "$ADMIN_FOLDER" ] || [ -z "$MOD_FOLDER" ] || [ -z "$PARTNER_FOLDER" ]; then
  echo "[provision] ERROR: could not resolve the dashboard folder uids (Admin='${ADMIN_FOLDER}' Mod='${MOD_FOLDER}' Partner='${PARTNER_FOLDER}')" >&2
  exit 1
fi

echo "[provision] Admin folder=${ADMIN_FOLDER}  Mod folder=${MOD_FOLDER}  Partner folder=${PARTNER_FOLDER}"

viewers() {
  jq -n --argjson ids "$1" '{items: [$ids[] | {userId: ., permission: 1}]}'
}

ADMIN_IDS="[${ADMIN_VIEWER_ID}]"
MOD_IDS="[${ADMIN_VIEWER_ID},${MOD_VIEWER_ID}]"
PARTNER_IDS="[${ADMIN_VIEWER_ID}]"
PARTNER_SUFFIX=""
if [ -n "$PARTNER_VIEWER_ID" ]; then
  MOD_IDS="[${ADMIN_VIEWER_ID},${MOD_VIEWER_ID},${PARTNER_VIEWER_ID}]"
  PARTNER_IDS="[${ADMIN_VIEWER_ID},${PARTNER_VIEWER_ID}]"
  PARTNER_SUFFIX=" + partner viewer"
fi

api POST "/api/folders/${ADMIN_FOLDER}/permissions" "$(viewers "$ADMIN_IDS")" >/dev/null
echo "[provision] Admin folder permissions set (admin viewer)."
api POST "/api/folders/${MOD_FOLDER}/permissions" "$(viewers "$MOD_IDS")" >/dev/null
echo "[provision] Mod folder permissions set (admin viewer + mod viewer${PARTNER_SUFFIX})."
api POST "/api/folders/${PARTNER_FOLDER}/permissions" "$(viewers "$PARTNER_IDS")" >/dev/null
echo "[provision] Partner folder permissions set (admin viewer${PARTNER_SUFFIX})."

echo "[provision] done."
