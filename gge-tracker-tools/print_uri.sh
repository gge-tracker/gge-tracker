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
#  Simple script to print useful URIs.                                               #
#                                                                                    #
######################################################################################

blue_color='\033[0;34m'
white_color='\033[1;37m'
reset_color='\033[0m'
echo -e "==============================="
echo -e " GGE-Tracker - Print URI Tool  "
echo -e "==============================="
echo -e ""
echo -e "${blue_color}gge-tracker Web application (Dynamic/Hot Reload): ${white_color}http://localhost:4200${reset_color}/"
echo -e "${blue_color}gge-tracker REST API: ${white_color}http://localhost:3000/${reset_color}"
echo -e "${blue_color}gge-tracker Web application (Static/Nginx) with production data: ${white_color}http://localhost:4201${reset_color}/"
echo -e "${blue_color}Grafana Dashboard: ${white_color}http://localhost:3001/${reset_color}"
echo ""
