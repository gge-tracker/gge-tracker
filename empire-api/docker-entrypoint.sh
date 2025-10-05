#!/bin/sh

# This script starts Xvfb and then executes the command passed as arguments
# It was originally used for generating reCAPTCHA tokens in a headless environment
# but it's now a legacy script kept in case we need it in the future.

echo "[ENTRYPOINT] Starting Xvfb..."
Xvfb :99 -screen 0 1920x1080x24 &

export DISPLAY=:99

exec "$@"
