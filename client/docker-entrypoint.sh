#!/bin/sh
set -e

BASE_PATH="${BASE_PATH:-}"

# Replace build-time placeholder with runtime BASE_PATH in all static assets.
# This is a no-op for local builds where the real BASE_PATH was baked in.
find /usr/share/nginx/html -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) \
  -exec sed -i "s|/__COPICK_BASE_PATH__|${BASE_PATH}|g" {} +
