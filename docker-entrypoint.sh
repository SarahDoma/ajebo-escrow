#!/bin/sh
set -e
# Hosted volumes (Fly.io, Railway) are mounted owned by root. Hand /data to the
# unprivileged "node" user, then drop root before starting the app.
if [ "$(id -u)" = "0" ]; then
  chown -R node /data 2>/dev/null || true
  chmod 700 /data 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
