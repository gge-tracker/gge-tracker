#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
output_dir=gge-tracker-frontend/dist/gge-tracker-frontend/browser/sitemaps
mkdir -p "$output_dir"

docker compose run --rm --no-deps --user "$(stat -c '%u:%g' "$output_dir")" sitemap-generator
