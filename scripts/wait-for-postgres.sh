#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."

MAX_RETRIES=30
RETRY_INTERVAL=2
retry_count=0

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"; do
  retry_count=$((retry_count + 1))
  if [ $retry_count -ge $MAX_RETRIES ]; then
    echo "Error: PostgreSQL did not become ready after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "PostgreSQL is not ready yet. Retrying in ${RETRY_INTERVAL}s... (attempt $retry_count/$MAX_RETRIES)"
  sleep $RETRY_INTERVAL
done

echo "PostgreSQL is ready! Running migrations..."
