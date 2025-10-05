#/bin/sh

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
#  Check script to verify the environment configuration.                             #
#                                                                                    #
######################################################################################

# Colors
red_color='\033[0;31m'
green_color='\033[0;32m'
yellow_color='\033[1;33m'
blue_color='\033[0;34m'
reset_color='\033[0m'

cd "$(dirname "$0")" || exit 1
cd ../.. || exit 1

required_dirs=("docker" "database" "gge-tracker-tools" "monitoring")
for dir in "${required_dirs[@]}"; do
    if [ ! -d "$dir" ]; then
        echo -e "${red_color} Error: Required directory '$dir' is missing.${reset_color}"
        exit 1
    fi
done

if ! command -v docker-compose &> /dev/null
then
    echo -e "${red_color} Docker Compose could not be found. Please install Docker Compose v2 or higher."
    echo -e " Visit https://docs.docker.com/compose/install/ for installation instructions.${reset_color}"
    exit 1
fi
if ! docker compose version | grep 'v2' &> /dev/null
then
    echo -e "${red_color} Docker Compose v2 or higher is required. Please update your Docker Compose installation.${reset_color}"
    exit 1
fi

if [ ! -f .env ]; then
    echo -e "${yellow_color} A .env file was not found. A template .env file has been created. Please edit it with your configuration values and restart the script.${reset_color}"
    exit 1
fi

echo -e "${green_color} All checks passed. Your environment looks good!${reset_color}"
exit 0
