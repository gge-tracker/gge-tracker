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
######################################################################################

FROM alpine/git:2.49.1 AS base
WORKDIR /app

RUN git clone --depth=1 --branch=main https://github.com/gge-tracker/database-csv.git /app/database-csv
RUN rm -rf ./.git

RUN if [ ! -d /app/database-csv/clickhouse ]; then \
    echo "Error: /app/database-csv/clickhouse directory not found!"; \
    ls -la /app/database-csv && exit 1; \
fi

FROM docker:27.0-cli AS final

RUN apk add --no-cache bash
WORKDIR /scripts

COPY . .
COPY --from=base /app/database-csv/ /scripts/


RUN if [ ! -d /scripts/clickhouse ]; then \
    echo "Error: /scripts/clickhouse directory not found!"; \
    ls -la /scripts && exit 1; \
fi

