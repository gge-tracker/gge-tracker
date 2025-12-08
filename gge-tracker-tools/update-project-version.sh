#!/usr/bin/env bash

######################################################################################
#                                     __                        __                   #
#      ____   ____   ____           _/  |_____________    ____ |  | __ ___________   #
#     / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \  #
#    / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/  #
#    \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|     #
#   /_____//_____/      \/                            \/     \/     \/    \/         #
#                                                                                    #
#                     This file is part of the gge-tracker project.                  #
#        Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors            #
#                                                                                    #
#  This script updates the version number across all project packages.               #
#                                                                                    #
######################################################################################

set -e

# ─────────────────────────────────────────────
# 1. Generate version: YY.MM.DD-beta
# ─────────────────────────────────────────────
YEAR=$(date +"%y")
MONTH=$(date +"%m")
DAY=$(date +"%d")
# Note : Using -beta suffix for pre-release versions, but
# will be removed for stable releases.
VERSION="${YEAR}.${MONTH}.${DAY}-beta"
RED_COLOR='\033[0;31m'
PINK_COLOR='\033[1;35m'
BLUE_COLOR='\033[1;34m'
GREEN_COLOR='\033[0;32m'
DARK_GRAY_COLOR='\033[0;30m'
RESET_COLOR='\033[0m'
echo -e "${GREEN_COLOR}Starting version update to ${VERSION}${RESET_COLOR}"

# ─────────────────────────────────────────────
# 2. Write version to root VERSION file
# ─────────────────────────────────────────────
echo "$VERSION" > VERSION
echo "Updated root VERSION file."

# ─────────────────────────────────────────────
# 3. List of packages to update
# ─────────────────────────────────────────────
PACKAGES=(
  "empire-api"
  "gge-tracker-backend-api"
  "gge-tracker-frontend"
  "gge-tracker-internal-scraping"
  "sitemap-generator"
)

cd "$(dirname "$0")/.." || exit 1
BASE_DIR=$(pwd)
echo "Project root directory: $BASE_DIR"

# ─────────────────────────────────────────────
# 4. Update version in each package.json
# ─────────────────────────────────────────────
for pkg in "${PACKAGES[@]}"; do
  PKG_PATH="./$pkg/package.json"

  if [ -f "$PKG_PATH" ]; then
    echo ""
    echo "───────────────────────[ Begin new Update ]───────────────────────"
    echo -e "${DARK_GRAY_COLOR}Package: $pkg${RESET_COLOR}"
    echo -e "${DARK_GRAY_COLOR}Updating version in $PKG_PATH...${RESET_COLOR}"
    if command -v jq &> /dev/null; then
      TMP=$(mktemp)
      old_version=$(jq -r '.version' "$PKG_PATH")
      jq --arg v "$VERSION" '.version = $v' "$PKG_PATH" > "$TMP"
      mv "$TMP" "$PKG_PATH"
    else
      sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$PKG_PATH"
    fi

    echo -e "${GREEN_COLOR}Version updated (${PINK_COLOR}$old_version${GREEN_COLOR} ──> ${BLUE_COLOR}$VERSION${GREEN_COLOR})${RESET_COLOR}"

    # ─────────────────────────────────────────────
    # 5. Run npm install to update package-lock.json
    # ─────────────────────────────────────────────
    (
      cd "$BASE_DIR/$pkg" || exit 1
      echo -e "${DARK_GRAY_COLOR}Running npm install in $pkg...${RESET_COLOR}"
      if [ -d "node_modules" ]; then
        # Patch: chown to avoid permission issues in some environments
        sudo chown -R "$(whoami)":"$(whoami)" node_modules/ 2>/dev/null
      fi
      npm install --silent
      echo -e "${GREEN_COLOR}npm install completed in $pkg.${RESET_COLOR}"
    )
  else
    echo -e "${RED_COLOR}Skipping $pkg (no package.json)${RESET_COLOR}"
  fi
  echo "──────────────────────────[ End Update ]──────────────────────────"
done

# ─────────────────────────────────────────────
# 5.1. PATCH: Update API Swagger Documentation version
# ─────────────────────────────────────────────
echo ""
echo "───────────────────────[ Begin new Patch ]───────────────────────"
echo -e "${DARK_GRAY_COLOR}Patch: API Swagger Documentation Version${RESET_COLOR}"
echo -e "${DARK_GRAY_COLOR}Updating API documentation version...${RESET_COLOR}"
API_DOC_PATH="$BASE_DIR/gge-tracker-backend-api/src/documentation.js"
if [ -f "$API_DOC_PATH" ]; then
  sed -i "s/version: \".*\"/version: \"$VERSION\"/" "$API_DOC_PATH"
  echo -e "${GREEN_COLOR}Version updated to ${BLUE_COLOR}$VERSION${RESET_COLOR}"
fi
echo "──────────────────────────[ End Patch ]──────────────────────────"

echo "---"
echo -e "${GREEN_COLOR}Predeploy script completed successfully!${RESET_COLOR}"
echo -e "${GREEN_COLOR}Current version: ${BLUE_COLOR}$VERSION${RESET_COLOR}"
