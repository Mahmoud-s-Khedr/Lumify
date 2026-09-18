#!/usr/bin/env sh
set -eu

environment_file=${1:-.env.production}

case "$environment_file" in
  */*) ;;
  *) environment_file="./$environment_file" ;;
esac

if [ ! -f "$environment_file" ]; then
  echo "Environment file not found: $environment_file" >&2
  exit 1
fi

read_environment_value() {
  sed -n "s/^$1=//p" "$environment_file" | tail -n 1
}

configured_rate=$(read_environment_value NGINX_RATE_LIMIT)
configured_burst=$(read_environment_value NGINX_RATE_LIMIT_BURST)

if [ -n "$configured_rate" ]; then
  NGINX_RATE_LIMIT=$configured_rate
fi
if [ -n "$configured_burst" ]; then
  NGINX_RATE_LIMIT_BURST=$configured_burst
fi

: "${NGINX_RATE_LIMIT:=20r/s}"
: "${NGINX_RATE_LIMIT_BURST:=40}"

case "$NGINX_RATE_LIMIT" in
  *r/s)
    rate_number=${NGINX_RATE_LIMIT%r/s}
    ;;
  *r/m)
    rate_number=${NGINX_RATE_LIMIT%r/m}
    ;;
  *)
    echo 'NGINX_RATE_LIMIT must use Nginx syntax such as 20r/s or 1200r/m.' >&2
    exit 1
    ;;
esac

case "$rate_number" in
  *[!0-9]* | '' | 0)
    echo 'NGINX_RATE_LIMIT must use Nginx syntax such as 20r/s or 1200r/m.' >&2
    exit 1
    ;;
esac

case "$NGINX_RATE_LIMIT_BURST" in
  *[!0-9]* | '' | 0)
    echo 'NGINX_RATE_LIMIT_BURST must be a positive integer.' >&2
    exit 1
    ;;
esac

export NGINX_RATE_LIMIT NGINX_RATE_LIMIT_BURST
envsubst '${NGINX_RATE_LIMIT} ${NGINX_RATE_LIMIT_BURST}' < deploy/nginx/lumify.conf.template
