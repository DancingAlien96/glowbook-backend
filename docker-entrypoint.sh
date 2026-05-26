#!/bin/sh
set -e

# Sync the schema. If you later add proper migration files under prisma/migrations,
# switch this to `npx prisma migrate deploy`.
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "✦ Applying Prisma migrations..."
  npx prisma migrate deploy
else
  echo "✦ Syncing schema with prisma db push..."
  npx prisma db push --skip-generate --accept-data-loss
fi

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "✦ Seeding database..."
  npx prisma db seed || echo "⚠ Seed failed (continuing)"
fi

echo "✦ Starting Glowbook API..."
exec node dist/server.js
