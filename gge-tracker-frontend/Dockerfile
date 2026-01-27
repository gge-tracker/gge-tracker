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

FROM node:20-slim AS build

WORKDIR /app
COPY ./package*.json ./
RUN npm ci
COPY . .
ARG BUILD_ENV=prod
RUN if [ "$BUILD_ENV" = "beta" ]; then \
    cp src/app/app.component.html.beta src/app/app.component.html; \
    fi
RUN if [ "$BUILD_ENV" = "beta" ]; then \
    NEW_VERSION="beta.$(date +%s)"; \
    sed -i "3s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json; \
    cp src/environments/environment.production-beta.ts src/environments/environment.production.ts; \
    fi
RUN npm run build --output-path=dist --configuration=production

FROM node:20-slim AS production

RUN apt-get update \
    && apt-get install -y nginx \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist /usr/share/nginx/html

RUN useradd -r -d /var/www -s /sbin/nologin nginx
RUN chown -R nginx:nginx /usr/share/nginx/html
COPY ./nginx/nginx.conf /etc/nginx/sites-available/default

RUN service nginx reload

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
