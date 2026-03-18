#!/bin/sh
# Print docker build args for commit info.
# Usage: docker build $(./scripts/generate-commit-info.sh) .
set -e
HASH=$(git rev-parse HEAD)
DATE=$(git log -1 --format=%aI)
MESSAGE=$(git log -1 --format=%s)
printf -- '--build-arg COMMIT_HASH=%s --build-arg COMMIT_DATE=%s --build-arg COMMIT_MESSAGE=%s\n' "$HASH" "$DATE" "$MESSAGE"
