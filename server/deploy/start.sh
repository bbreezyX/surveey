#!/bin/sh
set -eu
if [ "${SURVEY_DEPLOYMENT:-}" = "railway" ]; then
  exec python railway_runtime.py "$1"
fi
: "${ORIGIN_TLS_CERT:?Mount a trusted origin TLS certificate}"
: "${ORIGIN_TLS_KEY:?Mount the origin TLS private key}"
# Do not infer HTTPS from a caller-controlled forwarding header.
exec gunicorn "$1" --bind 0.0.0.0:8443 --workers 2 --threads 1 --timeout 60 \
  --certfile "$ORIGIN_TLS_CERT" --keyfile "$ORIGIN_TLS_KEY" \
  --forwarded-allow-ips='' --limit-request-line 4094 --limit-request-fields 40 \
  --limit-request-field_size 8190 --access-logfile - --error-logfile -
