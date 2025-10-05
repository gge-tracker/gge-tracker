#/bin/sh
#                                   __                        __
#    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
#   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
#  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
#  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
# /_____//_____/      \/                            \/     \/     \/    \/
#
#  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
#

BASE_SCRIPT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
docker build -t gge-tracker-internal-scraping "$BASE_SCRIPT_DIR"
if [ $? -ne 0 ]; then
    echo "Docker build failed"
    exit 1
fi
echo "Docker image 'gge-tracker-internal-scraping' built successfully"
