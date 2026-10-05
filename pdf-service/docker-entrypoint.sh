#!/bin/sh
set -e

# STORAGE_ROOT is a Docker named volume: it mounts as root:root regardless of the
# image layers, so the non-root runtime user cannot write to it. The container
# starts as root (USER root in the Dockerfile); chown the volume, then drop
# privileges to the pdfservice user via setpriv (util-linux, already present in
# the base image — no apt install needed, which matters because build containers
# here have no outbound DNS).
if [ -n "$STORAGE_ROOT" ] && [ "$(id -u)" = "0" ]; then
  mkdir -p "$STORAGE_ROOT"
  chown -R 1001:1001 "$STORAGE_ROOT"
  exec setpriv --reuid=1001 --regid=65534 --clear-groups node src/index.js
fi

exec node src/index.js
