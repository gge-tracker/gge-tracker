FROM node:20-slim AS build

WORKDIR /app
COPY ./package*.json ./
RUN npm ci
COPY . .
ARG BUILD_ENV=prod
RUN if [ "$BUILD_ENV" = "beta" ]; then cp src/app/app.component.html.beta src/app/app.component.html; fi
RUN if [ "$BUILD_ENV" = "beta" ]; then cp src/environments/environment.prod-beta.ts src/environments/environment.prod.ts; fi
RUN npm run build --output-path=dist --configuration=production

FROM node:20-slim AS production

RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist /usr/share/nginx/html

RUN useradd -r -d /var/www -s /sbin/nologin nginx
RUN chown -R nginx:nginx /usr/share/nginx/html
COPY ./nginx/nginx.conf /etc/nginx/sites-available/default

RUN service nginx reload

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
