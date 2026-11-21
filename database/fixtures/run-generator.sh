#!/usr/bin/env bash
##########################################################################################
#                     This file is part of the gge-tracker project.                      #
#        Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors                #
##########################################################################################
#
GENERATOR_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run_generator() {  # <output set> <servers file> <generator arguments...>
  local set="$1" servers_file="$2"
  shift 2
  mkdir -p "$GENERATOR_REPO/database/fixtures/generated"
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "$GENERATOR_REPO:/repo:ro" \
    -v "$GENERATOR_REPO/database/fixtures/generated:/out" \
    -v "$servers_file:/servers.xml:ro" \
    node:24-alpine node --no-warnings /repo/database/fixtures/generator/generate.mjs \
    --servers-file /servers.xml --schema-dir /repo/database/schema --migrations-dir /repo/database/migrations \
    --out "/out/$set" "$@"
}
