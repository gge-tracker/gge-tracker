#!/bin/sh
set -e

if [ -n "$SEO_BACKEND" ]; then
    sed -i "s|set \$seo_backend \".*\";|set \$seo_backend \"$SEO_BACKEND\";|" /etc/nginx/sites-available/default
fi

export SSR_API_URL="${SSR_API_URL:-${SEO_BACKEND:-http://backend-container:3000}/api/v1/}"
export NODE_ENV=production

(
    while true; do
        setpriv --reuid=node --regid=node --init-groups \
            node --max-old-space-size=1024 /usr/share/nginx/html/gge-tracker-frontend/server/server.mjs || true
        sleep 2
    done
) &

exec nginx -g 'daemon off;'
