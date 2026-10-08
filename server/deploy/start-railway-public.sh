#!/bin/sh
set -eu
: "${RAILWAY_ENVIRONMENT_ID:?Railway environment required}"
: "${PUBLIC_DATA_HOST:?Set the private data-service hostname}"
case "$PUBLIC_DATA_HOST" in
  *[!a-zA-Z0-9.-]*) echo 'Invalid PUBLIC_DATA_HOST' >&2; exit 1 ;;
  *.railway.internal) ;;
  *) echo 'Public data must use Railway private networking' >&2; exit 1 ;;
esac
: "${PUBLIC_ADMIN_HOST:?Set the private admin-service hostname}"
case "$PUBLIC_ADMIN_HOST" in
  *[!a-zA-Z0-9.-]*) echo 'Invalid PUBLIC_ADMIN_HOST' >&2; exit 1 ;;
  *.railway.internal) ;;
  *) echo 'Admin must use Railway private networking' >&2; exit 1 ;;
esac
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
