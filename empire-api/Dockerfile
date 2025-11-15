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

FROM node:24-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci
COPY src ./src
COPY tsconfig.json ./

RUN npx tsc

COPY src/config ./dist/config
COPY src/data ./dist/data

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY package*.json ./

RUN npm ci --omit=dev

ARG API_TYPE
RUN if [ $API_TYPE = "realtime" ]; then \
    cp dist/config/credentials_gbl.json dist/config/credentials.json && \
    cp dist/config/instances_gbl.json dist/config/instances.json; \
fi

RUN mv dist/* . && rm -rf dist

CMD ["node", "server.js"]
