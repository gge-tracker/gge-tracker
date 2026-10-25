#!/bin/sh
set -e

if [ -n "$SEO_BACKEND" ]; then
    sed -i "s|set \$seo_backend \".*\";|set \$seo_backend \"$SEO_BACKEND\";|" /etc/nginx/sites-available/default
fi

exec nginx -g 'daemon off;'
