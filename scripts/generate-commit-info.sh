#!/bin/sh
# Generate commit-info.json for use in Docker containers where .git is unavailable.
set -e
cat > commit-info.json <<EOF
{
  "hash": "$(git rev-parse HEAD)",
  "date": "$(git log -1 --format=%aI)",
  "message": "$(git log -1 --format=%s | sed 's/"/\\"/g')"
}
EOF
