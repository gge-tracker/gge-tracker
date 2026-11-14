#!/bin/sh
#                                   __                        __
#    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
#   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
#  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
#  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
# /_____//_____/      \/                            \/     \/     \/    \/
#
#  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
#
# Lets a job that reads every server at once (the Chronicle) hold the fills back while it reads.

FILL_PAUSE_FILE="${FILL_PAUSE_FILE:-/tmp/gge-tracker-fills.pause}"
FILL_PAUSE_MAX_SECONDS="${FILL_PAUSE_MAX_SECONDS:-5400}"

fill_pause_active() {
    [ -f "$FILL_PAUSE_FILE" ] || return 1
    _age=$(( $(date +%s) - $(stat -c %Y "$FILL_PAUSE_FILE") ))
    [ "$_age" -lt "$FILL_PAUSE_MAX_SECONDS" ]
}

wait_while_fills_paused() {
    fill_pause_active || return 0
    _arrival_minute=$(date +%M)
    echo "Fills are paused by $FILL_PAUSE_FILE, waiting." >&2
    while fill_pause_active; do
        sleep 20
    done
    sleep $(( ${_arrival_minute#0} * 6 ))
}
