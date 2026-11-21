#!/usr/bin/env bash
######################################################################################
#                     This file is part of the gge-tracker project.                  #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors            #
#                                                                                    #
#  Prepares a fresh clone for the local stack. Never overwrites a file that exists.  #
#                                                                                    #
######################################################################################
set -euo pipefail
cd "$(dirname "$0")/.."

I18N_REPOSITORY="${I18N_REPOSITORY:-https://github.com/ggetracker/i18n.git}"
I18N_DIR="../i18n"

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[1;33m'
reset='\033[0m'
ok() { echo -e "  ${green}ok${reset}    $*"; }
made() { echo -e "  ${yellow}made${reset}  $*"; }
fail() { echo -e "  ${red}error${reset} $*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the docker compose v2 plugin is not installed"
command -v python3 >/dev/null || fail "python3 is needed by the database scripts"
ok "docker, docker compose and python3 found"

random_secret() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }

if [ -f .env ]; then
  ok ".env exists, left alone"
else
  cp .env.example .env
  for key in SQL_ROOT_PASSWORD SQL_PASSWORD CLICKHOUSE_PASSWORD INTERNAL_SECRET; do
    sed -i.bak -E "s/^${key}=put_your_.*/${key}=$(random_secret)/" .env
  done
  rm -f .env.bak
  made ".env from .env.example, with random database passwords"
fi

if [ -f gge-tracker-backend-api/config/servers.xml ]; then
  ok "servers.xml exists, left alone"
else
  cp gge-tracker-backend-api/config/servers.example.xml gge-tracker-backend-api/config/servers.xml
  made "servers.xml from servers.example.xml"
fi

for file in instances credentials; do
  for variant in "" _gbl; do
    target="empire-api/src/config/${file}${variant}.json"
    if [ ! -f "$target" ]; then
      cp "empire-api/src/config/${file}.example.json" "$target"
      made "${target} from its example (only read by the real bridge)"
    fi
  done
done

if [ -e gge-tracker-internal-scraping/.env ]; then
  ok "gge-tracker-internal-scraping/.env exists, left alone"
else
  ln -s ../.env gge-tracker-internal-scraping/.env
  made "gge-tracker-internal-scraping/.env, a link to the root .env"
fi

if docker network inspect backend >/dev/null 2>&1; then
  ok "docker network 'backend' exists"
else
  docker network create backend >/dev/null
  made "docker network 'backend'"
fi

if [ -d "$I18N_DIR" ]; then
  ok "translations found in ${I18N_DIR}"
elif command -v git >/dev/null; then
  git clone --quiet --depth 1 "$I18N_REPOSITORY" "$I18N_DIR"
  made "translations cloned into ${I18N_DIR}"
else
  fail "git is needed to clone the translations into ${I18N_DIR}"
fi

cat <<'NEXT'

  Next:
    docker compose up -d postgres clickhouse redis-server empire-api empire-api-realtime loki
    ./database/fixtures/load-fixtures.sh
    docker compose up -d backend-express-rest-api-dev backend-express-rest-api-mocked frontend-angular-node

  Then open http://localhost:4200. Both backends read the local fixture: :3000 serves the
  site, :3002 is the one the API test harness runs against.

  Fresh data for any server instead:  ./database/fixtures/generate.sh FR1
  Your own data from the game:       see "Collecting your own data" in README.md.
NEXT
