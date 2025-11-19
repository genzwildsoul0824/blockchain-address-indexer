#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."
sleep 5

echo "Pushing schema to database..."
bun run prisma:push --accept-data-loss --skip-generate

echo "Starting application..."
exec "$@"

