#!/bin/sh
# Weekly Grafana recap -> Discord webhook

set -eu

GF_URL="${GF_URL:-http://grafana:3000}"
PROM_URL="${PROM_URL:-http://prometheus:9090}"
CH_URL="${CH_URL:-http://${CLICKHOUSE_HOST:-clickhouse}:8123}"
PANELS_FILE="${RECAP_PANELS_FILE:-/scripts/panels.conf}"
WEBHOOK="${RECAP_WEBHOOK_URL:-${DISCORD_WEBHOOK_URL:-}}"
WINDOW_DAYS="${RECAP_WINDOW_DAYS:-7}"
THEME="${RECAP_THEME:-dark}"
SCALE="${RECAP_IMAGE_SCALE:-2}"
RENDER_TZ="${RECAP_RENDER_TZ:-UTC}"
RENDER_TIMEOUT="${RECAP_RENDER_TIMEOUT:-180}"
BOT_NAME="${RECAP_USERNAME:-gge-tracker}"
COLOR="${RECAP_EMBED_COLOR:-3447003}"
DRY_RUN="${RECAP_DRY_RUN:-0}"

log() { echo "[recap] $*" >&2; }

if [ -z "$WEBHOOK" ] && [ "$DRY_RUN" != "1" ]; then
  log "no webhook configured (RECAP_WEBHOOK_URL or DISCORD_WEBHOOK_URL); nothing to do"
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

NOW=$(date -u +%s)
SPAN=$((WINDOW_DAYS * 86400))
FROM=$((NOW - SPAN))
PREV_FROM=$((FROM - SPAN))
FROM_MS=$((FROM * 1000))
TO_MS=$((NOW * 1000))

fmt_date() { date -u -D %s -d "$1" +"$2" 2>/dev/null || date -u -d "@$1" +"$2"; }
PERIOD="$(fmt_date "$FROM" '%d %b') to $(fmt_date "$NOW" '%d %b %Y')"

num() { awk -v v="${1:-}" 'BEGIN { printf "%.10g", (v + 0) }'; }
field() { printf '%s' "$1" | sed -n '1p' | cut -f"$2"; }

count() {
  awk -v n="${1:-0}" 'BEGIN {
    n = n + 0
    if (n >= 1000000000) { printf "%.2fB", n / 1000000000 }
    else if (n >= 1000000) { printf "%.2fM", n / 1000000 }
    else if (n >= 1000) { printf "%.1fk", n / 1000 }
    else { printf "%d", n }
  }'
}

bytes() {
  awk -v b="${1:-0}" 'BEGIN {
    split("B KB MB GB TB PB", unit, " ")
    b = b + 0; i = 1
    while (b >= 1024 && i < 6) { b /= 1024; i++ }
    printf (i == 1 ? "%.0f %s" : "%.2f %s"), b, unit[i]
  }'
}

ratio() {
  awk -v a="${1:-0}" -v b="${2:-0}" 'BEGIN {
    if (b + 0 > 0) { printf "%.2f%%", (a + 0) * 100 / (b + 0) } else { printf "n/a" }
  }'
}

delta() {
  awk -v c="${1:-0}" -v p="${2:-0}" 'BEGIN {
    c = c + 0; p = p + 0
    if (p <= 0) { exit }
    d = (c - p) * 100 / p
    printf " %s %+.1f%%", (d >= 0 ? "▲" : "▼"), d
  }'
}

bullets() {
  awk -F'\t' '
    function human(n) {
      n = n + 0
      if (n >= 1000000000) { return sprintf("%.2fB", n / 1000000000) }
      if (n >= 1000000) { return sprintf("%.2fM", n / 1000000) }
      if (n >= 1000) { return sprintf("%.1fk", n / 1000) }
      return sprintf("%d", n)
    }
    NF >= 2 && $1 != "" { printf "· `%s` — %s\n", $1, human($2) }
  '
}

or_empty() { [ -n "$1" ] && printf '%s' "$1" || printf '%s' "_no data_"; }

ch() {
  printf '%s' "$1" | curl -fsS --max-time 120 \
    -H "X-ClickHouse-User: ${CLICKHOUSE_USER:-default}" \
    -H "X-ClickHouse-Key: ${CLICKHOUSE_PASSWORD:-}" \
    --data-binary @- "$CH_URL/" 2>/dev/null || true
}

prom() {
  curl -fsS --max-time 60 --get --data-urlencode "query=$1" "$PROM_URL/api/v1/query" 2>/dev/null \
    | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null || echo 0
}

prom_top() {
  curl -fsS --max-time 60 --get \
    --data-urlencode "query=topk($3, sum by (${2}) ($(cf_range "$1" "")))" \
    "$PROM_URL/api/v1/query" 2>/dev/null \
    | jq -r --arg l "$2" '.data.result | sort_by(-(.value[1] | tonumber)) | .[] | "\(.metric[$l])\t\(.value[1])"' 2>/dev/null || true
}

cf_range() {
  printf 'sum_over_time((last_over_time(%s{zone="%s"}[1h]))[%sd:1h]%s)' \
    "$1" "$CF_ZONE" "$WINDOW_DAYS" "$2"
}
cf_total() { prom "$(cf_range "$1" "$2")"; }

api_totals() {
  ch "SELECT count(), countIf(status >= 500), countIf(status >= 400 AND status < 500), uniqExact(server), uniqExact(route)
      FROM logs.logs
      WHERE timestamp >= toDateTime($1) AND timestamp < toDateTime($2) AND job = 'ggetracker-api'
      FORMAT TSV"
}

scrape_totals() {
  ch "SELECT count(), uniqExact(server), sum(criticalErrors), sum(playersCreated), sum(alliancesCreated),
        sum(playersAllianceUpdated), sum(alliancesUpdated), round(avg(durationMs) / 60000, 1), round(max(durationMs) / 60000, 1)
      FROM logs.scrapes
      WHERE timestamp >= toDateTime($1) AND timestamp < toDateTime($2)
      FORMAT TSV"
}

CF_ZONE="${RECAP_CF_ZONE:-}"
if [ -z "$CF_ZONE" ]; then
  CF_ZONE=$(curl -fsS --max-time 30 "$PROM_URL/api/v1/label/zone/values" 2>/dev/null \
    | jq -r '.data[0] // empty' 2>/dev/null || true)
fi
[ -n "$CF_ZONE" ] || log "no Cloudflare zone found in Prometheus, cloudflare panels will use the dashboard default"

sed -e 's/#.*//' -e 's/[[:space:]]//g' "$PANELS_FILE" | grep -v '^$' > "$WORKDIR/panels.txt"

urlencode_tz() { printf '%s' "$1" | sed 's|/|%2F|g'; }

is_png() {
  [ -s "$1" ] || return 1
  [ "$(dd if="$1" bs=1 count=4 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "89504e47" ]
}

render_section() {
  _section=$1
  _files=""
  _index=0
  while IFS='|' read -r _sec _uid _panel _width _height _extra; do
    if [ "$_sec" != "$_section" ]; then
      continue
    fi
    _index=$((_index + 1))
    _file="$WORKDIR/${_section}-${_index}-panel${_panel}.png"
    _url="$GF_URL/render/d-solo/$_uid/recap?orgId=1&panelId=$_panel&from=$FROM_MS&to=$TO_MS"
    _url="$_url&width=$_width&height=$_height&scale=$SCALE&theme=$THEME&tz=$(urlencode_tz "$RENDER_TZ")"
    if [ -n "$_extra" ]; then
      _url="$_url&$_extra"
    fi
    if [ "$_section" = "cloudflare" ] && [ -n "$CF_ZONE" ]; then
      _url="$_url&var-zone=$CF_ZONE"
    fi
    if curl -fsS --max-time "$RENDER_TIMEOUT" -u "$GF_USERNAME:$GF_PASSWORD" -o "$_file" "$_url" && is_png "$_file"; then
      _files="$_files $_file"
    else
      log "panel $_uid/$_panel did not render"
      rm -f "$_file"
    fi
  done < "$WORKDIR/panels.txt"
  printf '%s' "$_files"
}

embed() {
  jq -n --arg t "$1" --arg d "$(printf '%s' "$2" | head -c 3800)" --argjson c "$COLOR" \
    '[{title: $t, description: $d, color: $c}]'
}

post() {
  _embeds=$1
  shift
  for _file in "$@"; do
    _embeds=$(printf '%s' "$_embeds" | jq --arg n "$(basename "$_file")" --argjson c "$COLOR" \
      '. + [{color: $c, image: {url: ("attachment://" + $n)}}]')
  done
  _payload=$(jq -n --arg u "$BOT_NAME" --argjson e "$_embeds" '{username: $u, embeds: $e}')

  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$_payload"
    log "dry run: would attach $# image(s)"
    return 0
  fi

  _index=0
  _attachments=""
  for _file in "$@"; do
    _attachments="$_attachments -F files[$_index]=@$_file"
    _index=$((_index + 1))
  done
  curl -fsS --max-time 180 -F "payload_json=$_payload" $_attachments "$WEBHOOK" >/dev/null
  sleep 2
}

log "window $PERIOD (${WINDOW_DAYS}d), zone '${CF_ZONE}'"

CF_REQ=$(cf_total cloudflare_zone_requests_hour "")
CF_REQ_PREV=$(cf_total cloudflare_zone_requests_hour " offset ${WINDOW_DAYS}d")
CF_CACHED=$(cf_total cloudflare_zone_requests_cached_hour "")
CF_BW=$(cf_total cloudflare_zone_bandwidth_hour "")
CF_BW_PREV=$(cf_total cloudflare_zone_bandwidth_hour " offset ${WINDOW_DAYS}d")
CF_BW_CACHED=$(cf_total cloudflare_zone_bandwidth_cached_hour "")
CF_UNIQUES=$(cf_total cloudflare_zone_uniques_hour "")
CF_THREATS=$(cf_total cloudflare_zone_threats_hour "")
CF_PAGEVIEWS=$(cf_total cloudflare_zone_pageviews_hour "")
CF_MTD=$(prom 'max(cloudflare_account_http_data_transfer_month_to_date_bytes)')
CF_PROJECTED=$(prom 'max(cloudflare_account_http_data_transfer_projected_month_bytes)')

API_NOW=$(api_totals "$FROM" "$NOW")
API_PREV=$(api_totals "$PREV_FROM" "$FROM")
API_REQ=$(num "$(field "$API_NOW" 1)")
API_REQ_PREV=$(num "$(field "$API_PREV" 1)")
API_5XX=$(num "$(field "$API_NOW" 2)")
API_5XX_PREV=$(num "$(field "$API_PREV" 2)")
API_4XX=$(num "$(field "$API_NOW" 3)")
API_SERVERS=$(num "$(field "$API_NOW" 4)")
API_ROUTES=$(num "$(field "$API_NOW" 5)")

SCR_NOW=$(scrape_totals "$FROM" "$NOW")
SCR_PREV=$(scrape_totals "$PREV_FROM" "$FROM")
SCR_CYCLES=$(num "$(field "$SCR_NOW" 1)")
SCR_CYCLES_PREV=$(num "$(field "$SCR_PREV" 1)")
SCR_SERVERS=$(num "$(field "$SCR_NOW" 2)")
SCR_ERRORS=$(num "$(field "$SCR_NOW" 3)")
SCR_ERRORS_PREV=$(num "$(field "$SCR_PREV" 3)")
SCR_PLAYERS_NEW=$(num "$(field "$SCR_NOW" 4)")
SCR_PLAYERS_NEW_PREV=$(num "$(field "$SCR_PREV" 4)")
SCR_ALLIANCES_NEW=$(num "$(field "$SCR_NOW" 5)")
SCR_PLAYERS_UPD=$(num "$(field "$SCR_NOW" 6)")
SCR_ALLIANCES_UPD=$(num "$(field "$SCR_NOW" 7)")
SCR_AVG_MIN=$(num "$(field "$SCR_NOW" 8)")
SCR_MAX_MIN=$(num "$(field "$SCR_NOW" 9)")

MANAGED=$(ch "SELECT sum(players), sum(alliances)
  FROM (SELECT max(playerCount) AS players, max(allianceCount) AS alliances
    FROM logs.scrapes
    WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW)
    GROUP BY server)
  FORMAT TSV")
MANAGED_PLAYERS=$(num "$(field "$MANAGED" 1)")
MANAGED_ALLIANCES=$(num "$(field "$MANAGED" 2)")

overview=$(embed "Weekly recap — $PERIOD" \
"Cloudflare, API and scraping over the last ${WINDOW_DAYS} days, compared with the ${WINDOW_DAYS} days before.")
overview=$(printf '%s' "$overview" | jq \
  --arg cf "$(printf 'Requests **%s**%s\nBandwidth **%s**%s\nCache hit **%s**\nThreats **%s** · Page views **%s**' \
      "$(count "$CF_REQ")" "$(delta "$CF_REQ" "$CF_REQ_PREV")" \
      "$(bytes "$CF_BW")" "$(delta "$CF_BW" "$CF_BW_PREV")" \
      "$(ratio "$CF_CACHED" "$CF_REQ")" \
      "$(count "$CF_THREATS")" "$(count "$CF_PAGEVIEWS")")" \
  --arg api "$(printf 'Requests **%s**%s\n5xx **%s**%s · 4xx **%s**\nError rate **%s**\n%s servers · %s routes' \
      "$(count "$API_REQ")" "$(delta "$API_REQ" "$API_REQ_PREV")" \
      "$(count "$API_5XX")" "$(delta "$API_5XX" "$API_5XX_PREV")" "$(count "$API_4XX")" \
      "$(ratio "$(awk -v a="$API_4XX" -v b="$API_5XX" 'BEGIN { print a + b }')" "$API_REQ")" \
      "$(count "$API_SERVERS")" "$(count "$API_ROUTES")")" \
  --arg scr "$(printf 'Cycles **%s**%s on **%s** servers\nCritical errors **%s**%s\nNew players **%s**%s · new alliances **%s**\nTracked **%s** players / **%s** alliances\nCycle time avg **%s min** · max **%s min**' \
      "$(count "$SCR_CYCLES")" "$(delta "$SCR_CYCLES" "$SCR_CYCLES_PREV")" "$(count "$SCR_SERVERS")" \
      "$(count "$SCR_ERRORS")" "$(delta "$SCR_ERRORS" "$SCR_ERRORS_PREV")" \
      "$(count "$SCR_PLAYERS_NEW")" "$(delta "$SCR_PLAYERS_NEW" "$SCR_PLAYERS_NEW_PREV")" \
      "$(count "$SCR_ALLIANCES_NEW")" \
      "$(count "$MANAGED_PLAYERS")" "$(count "$MANAGED_ALLIANCES")" \
      "$SCR_AVG_MIN" "$SCR_MAX_MIN")" \
  '.[0].fields = [
      {name: "Cloudflare", value: $cf, inline: true},
      {name: "API", value: $api, inline: true},
      {name: "Scraping", value: $scr, inline: false}
    ]')
post "$overview"

cf_desc=$(printf 'Top countries\n%s\n\nBy HTTP status\n%s\n\nAccount transfer this month **%s**, projected **%s**' \
  "$(or_empty "$(prom_top cloudflare_zone_requests_country_hour country 5 | bullets)")" \
  "$(or_empty "$(prom_top cloudflare_zone_requests_status_hour status 5 | bullets)")" \
  "$(bytes "$CF_MTD")" "$(bytes "$CF_PROJECTED")")
# shellcheck disable=SC2046
post "$(embed "Cloudflare" "$cf_desc")" $(render_section cloudflare)

api_desc=$(printf 'Top routes\n%s\n\nMost 5xx\n%s\n\nBusiest servers\n%s' \
  "$(or_empty "$(ch "SELECT route, count() AS hits FROM logs.logs WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW) AND job = 'ggetracker-api' GROUP BY route ORDER BY hits DESC LIMIT 5 FORMAT TSV" | bullets)")" \
  "$(or_empty "$(ch "SELECT route, count() AS errors FROM logs.logs WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW) AND job = 'ggetracker-api' AND status >= 500 GROUP BY route ORDER BY errors DESC LIMIT 5 FORMAT TSV" | bullets)")" \
  "$(or_empty "$(ch "SELECT server, count() AS hits FROM logs.logs WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW) AND job = 'ggetracker-api' GROUP BY server ORDER BY hits DESC LIMIT 5 FORMAT TSV" | bullets)")")
# shellcheck disable=SC2046
post "$(embed "API monitoring" "$api_desc")" $(render_section api)

scr_desc=$(printf 'Slowest servers (max minutes per cycle)\n%s\n\nCritical errors by server\n%s\n\nMost new players\n%s\n\nUpdates: **%s** player-alliance links · **%s** alliances' \
  "$(or_empty "$(ch "SELECT server, round(max(durationMs) / 60000, 1) AS minutes FROM logs.scrapes WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW) GROUP BY server ORDER BY minutes DESC LIMIT 5 FORMAT TSV" | bullets)")" \
  "$(or_empty "$(ch "SELECT server, sum(criticalErrors) AS errors FROM logs.scrapes WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW) GROUP BY server HAVING errors > 0 ORDER BY errors DESC LIMIT 5 FORMAT TSV" | bullets)")" \
  "$(or_empty "$(ch "SELECT server, sum(playersCreated) AS created FROM logs.scrapes WHERE timestamp >= toDateTime($FROM) AND timestamp < toDateTime($NOW) GROUP BY server HAVING created > 0 ORDER BY created DESC LIMIT 5 FORMAT TSV" | bullets)")" \
  "$(count "$SCR_PLAYERS_UPD")" "$(count "$SCR_ALLIANCES_UPD")")
# shellcheck disable=SC2046
post "$(embed "Scraping monitoring" "$scr_desc")" $(render_section scraping)

log "done"
