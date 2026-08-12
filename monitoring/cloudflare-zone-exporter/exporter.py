##########################################################################################
#                                     __                        __                       #
#      ____   ____   ____           _/  |_____________    ____ |  | __ ___________       #
#     / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \      #
#    / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/      #
#    \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|         #
#   /_____//_____/      \/                            \/     \/     \/    \/             #
#                                                                                        #
#                     This file is part of the gge-tracker project.                      #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors                #
#                                                                                        #
##########################################################################################

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
ZONES_URL = "https://api.cloudflare.com/client/v4/zones?per_page=50"

API_TOKEN = os.environ.get("CF_API_TOKEN", "").strip()
ZONE_FILTER = [z.strip() for z in os.environ.get("CF_ZONES", "").split(",") if z.strip()]
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8081"))
SCRAPE_INTERVAL = int(os.environ.get("SCRAPE_INTERVAL", "300"))
HTTP_TIMEOUT = int(os.environ.get("CF_TIMEOUT", "20"))
LAG_MINUTES = int(os.environ.get("SCRAPE_DELAY_MINUTES", "10"))
MAX_COUNTRIES = int(os.environ.get("MAX_COUNTRIES", "40"))

# Shared between the poll thread and the HTTP handlers
_lock = threading.Lock()
_payload = "# cloudflare-zone-exporter starting, no scrape completed yet\n"


def log(level, *parts):
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"{stamp} {level} " + " ".join(str(p) for p in parts), file=sys.stderr, flush=True)


def api_get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def graphql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=body,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        doc = json.loads(resp.read().decode("utf-8"))
    if doc.get("errors"):
        raise RuntimeError(json.dumps(doc["errors"])[:400])
    return doc.get("data") or {}


def discover_zones():
    """Zone id -> name for every zone the token can read, honouring CF_ZONES."""
    doc = api_get(ZONES_URL)
    if not doc.get("success"):
        raise RuntimeError(f"zone listing failed: {json.dumps(doc.get('errors'))[:300]}")
    zones = {z["id"]: z["name"] for z in doc.get("result") or []}
    if ZONE_FILTER:
        zones = {zid: name for zid, name in zones.items() if zid in ZONE_FILTER}
    return zones


def escape(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


class Registry:
    """Minimal gauge-only registry emitting the Prometheus text exposition format."""

    def __init__(self):
        self._families = {}
        self._order = []

    def gauge(self, name, help_text, labels, value):
        if name not in self._families:
            self._families[name] = {"help": help_text, "samples": []}
            self._order.append(name)
        label_str = ",".join(f'{k}="{escape(v)}"' for k, v in labels.items())
        self._families[name]["samples"].append((label_str, float(value)))

    def render(self):
        out = []
        for name in self._order:
            family = self._families[name]
            out.append(f"# HELP {name} {family['help']}")
            out.append(f"# TYPE {name} gauge")
            for label_str, value in family["samples"]:
                suffix = f"{{{label_str}}}" if label_str else ""
                out.append(f"{name}{suffix} {value!r}")
        return "\n".join(out) + "\n"


Q_HOURLY = """
query ($zone: String!, $mintime: Time!, $maxtime: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1hGroups(limit: 24, filter: { datetime_geq: $mintime, datetime_lt: $maxtime }) {
      dimensions { datetime }
      sum { requests bytes cachedRequests cachedBytes threats pageViews encryptedRequests }
      uniq { uniques }
    } } } }
"""

Q_DAILY = """
query ($zone: String!, $date: String!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1dGroups(limit: 1, filter: { date: $date }) {
      dimensions { date }
      sum { requests bytes cachedRequests cachedBytes threats pageViews }
      uniq { uniques }
    } } } }
"""

Q_BY_DIMENSION = """
query ($zone: String!, $mintime: Time!, $maxtime: Time!, $limit: Int!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(limit: $limit, filter: { datetime_geq: $mintime, datetime_lt: $maxtime }) {
      count
      avg { sampleInterval }
      sum { edgeResponseBytes }
      dimensions { %s }
    } } } }
"""


def zone_rows(data, field):
    zones = (data.get("viewer") or {}).get("zones") or []
    if not zones:
        return []
    return zones[0].get(field) or []


def estimated(row):
    """Adaptive datasets are sampled"""
    interval = ((row.get("avg") or {}).get("sampleInterval")) or 1
    return (row.get("count") or 0) * interval


def collect_by_dimension(reg, zone_id, zone_name, dimension, metric_suffix, help_text, window, label_name=None, top_n=None):
    rows = zone_rows(graphql(Q_BY_DIMENSION % dimension, {"zone": zone_id, "limit": 5000, **window}),"httpRequestsAdaptiveGroups")

    requests, byte_totals = {}, {}
    for row in rows:
        key = (row.get("dimensions") or {}).get(dimension)
        if key is None:
            continue
        key = str(key)
        requests[key] = requests.get(key, 0) + estimated(row)
        byte_totals[key] = byte_totals.get(key, 0) + ((row.get("sum") or {}).get("edgeResponseBytes") or 0)

    items = sorted(requests.items(), key=lambda kv: kv[1], reverse=True)
    if top_n:
        items = items[:top_n]

    label = label_name or dimension
    for key, value in items:
        reg.gauge(f"cloudflare_zone_requests_{metric_suffix}", help_text, {"zone": zone_name, label: key}, value)
        reg.gauge(f"cloudflare_zone_bandwidth_{metric_suffix}", f"Edge response bytes in the last complete hour, by {label}", {"zone": zone_name, label: key}, byte_totals.get(key, 0))

HOURLY_FIELDS = [
    ("requests_hour", "requests", "Requests in the last complete hour"),
    ("bandwidth_hour", "bytes", "Bytes served in the last complete hour"),
    ("requests_cached_hour", "cachedRequests", "Cached requests in the last complete hour"),
    ("bandwidth_cached_hour", "cachedBytes", "Cached bytes in the last complete hour"),
    ("requests_ssl_encrypted_hour", "encryptedRequests", "Encrypted requests in the last complete hour"),
    ("threats_hour", "threats", "Threats blocked in the last complete hour"),
    ("pageviews_hour", "pageViews", "Page views in the last complete hour"),
]

DAILY_FIELDS = [
    ("requests_today", "requests", "Requests today (UTC, partial until midnight)"),
    ("bandwidth_today", "bytes", "Bytes served today (UTC, partial until midnight)"),
    ("requests_cached_today", "cachedRequests", "Cached requests today (UTC)"),
    ("bandwidth_cached_today", "cachedBytes", "Cached bytes today (UTC)"),
    ("threats_today", "threats", "Threats blocked today (UTC)"),
    ("pageviews_today", "pageViews", "Page views today (UTC)"),
]


def collect_zone(reg, zone_id, zone_name, window, today):
    rows = zone_rows(graphql(Q_HOURLY, {"zone": zone_id, **window}), "httpRequests1hGroups")
    if rows:
        row = max(rows, key=lambda r: (r.get("dimensions") or {}).get("datetime", ""))
        totals = row.get("sum") or {}
        for metric, key, help_text in HOURLY_FIELDS:
            reg.gauge(f"cloudflare_zone_{metric}", help_text, {"zone": zone_name}, totals.get(key, 0))
        reg.gauge("cloudflare_zone_uniques_hour", "Unique visitors in the last complete hour",
                  {"zone": zone_name}, (row.get("uniq") or {}).get("uniques", 0))

        bucket = (row.get("dimensions") or {}).get("datetime")
        if bucket:
            stamp = datetime.strptime(bucket, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            reg.gauge("cloudflare_zone_last_bucket_timestamp_seconds",
                      "Start of the hour the _hour metrics describe (unix seconds)",
                      {"zone": zone_name}, stamp.timestamp())

    rows = zone_rows(graphql(Q_DAILY, {"zone": zone_id, "date": today}), "httpRequests1dGroups")
    if rows:
        totals = rows[0].get("sum") or {}
        for metric, key, help_text in DAILY_FIELDS:
            reg.gauge(f"cloudflare_zone_{metric}", help_text, {"zone": zone_name}, totals.get(key, 0))
        reg.gauge("cloudflare_zone_uniques_today", "Unique visitors today (UTC)",
                  {"zone": zone_name}, (rows[0].get("uniq") or {}).get("uniques", 0))

    # Breakdowns part
    collect_by_dimension(reg, zone_id, zone_name, "edgeResponseStatus", "status_hour",
      "Requests in the last complete hour, by edge HTTP status",
      window, label_name="status")
    collect_by_dimension(reg, zone_id, zone_name, "clientCountryName", "country_hour",
      "Requests in the last complete hour, by client country",
      window, label_name="country", top_n=MAX_COUNTRIES)
    collect_by_dimension(reg, zone_id, zone_name, "cacheStatus", "cache_status_hour",
      "Requests in the last complete hour, by cache status",
      window, label_name="cache_status")
    collect_by_dimension(reg, zone_id, zone_name, "clientRequestHTTPHost", "host_hour",
      "Requests in the last complete hour, by requested host",
      window, label_name="host")


def scrape_once():
    reg = Registry()
    started = time.time()
    end = (datetime.now(timezone.utc) - timedelta(minutes=LAG_MINUTES)).replace(minute=0, second=0, microsecond=0)
    window = {
        "mintime": (end - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "maxtime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ok = 1
    try:
        zones = discover_zones()
        if not zones:
            log("WARN", "token can read no zones (or CF_ZONES matched none)")
        for zone_id, zone_name in zones.items():
            try:
                collect_zone(reg, zone_id, zone_name, window, today)
            except Exception as exc:  # one bad zone must not blank the others
                ok = 0
                log("ERROR", f"zone {zone_name}:", exc)
    except Exception as exc:
        ok = 0
        log("ERROR", "scrape failed:", exc)

    reg.gauge("cloudflare_zone_exporter_up", "1 if the last scrape completed without error", {}, ok)
    reg.gauge("cloudflare_zone_exporter_scrape_duration_seconds", "Duration of the last Cloudflare API scrape", {}, time.time() - started)
    reg.gauge("cloudflare_zone_exporter_last_scrape_timestamp_seconds", "Completion time of the last scrape (unix seconds)", {}, time.time())
    return reg.render()


def poll_forever():
    global _payload
    while True:
        text = scrape_once()
        with _lock:
            _payload = text
        time.sleep(SCRAPE_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/metrics", "/"):
            with _lock:
                body = _payload.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        elif path == "/healthz":
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
        else:
            body = b"not found\n"
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def main():
    if not API_TOKEN:
        log("FATAL", "CF_API_TOKEN is empty")
        sys.exit(1)
    threading.Thread(target=poll_forever, daemon=True).start()
    log("INFO", f"listening on :{LISTEN_PORT}/metrics, scrape interval {SCRAPE_INTERVAL}s")
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
