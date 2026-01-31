/**
 * Database query operations
 */

import { Effect } from 'effect'
// biome-ignore lint/style/useImportType: pg is used in type annotations
import pg from 'pg'
import { tryAsync } from '@/scripts/utils/effect-helpers'
import type { AdminBoundaryImport } from '@/types/import.types'

const insertQuery = `
  INSERT INTO admin_boundaries (wikidata_id, commons_category, admin_level, name, geom)
  VALUES ($1, $2, $3, $4, ST_GeomFromEWKT($5))
  ON CONFLICT (wikidata_id) DO UPDATE
    SET commons_category = EXCLUDED.commons_category,
        admin_level = EXCLUDED.admin_level,
        name = EXCLUDED.name,
        geom = EXCLUDED.geom
`

export function insertBoundary(
  client: pg.PoolClient,
  boundary: AdminBoundaryImport,
): Effect.Effect<void, Error> {
  return tryAsync(async () => {
    await client.query(insertQuery, [
      boundary.wikidata_id,
      boundary.commons_category,
      boundary.admin_level,
      boundary.name,
      boundary.geom,
    ])
  }, `Error inserting ${boundary.name}`)
}

export function beginTransaction(client: pg.PoolClient): Effect.Effect<void, Error> {
  return tryAsync(async () => await client.query('BEGIN'), 'Failed to begin transaction')
}

export function commitTransaction(client: pg.PoolClient): Effect.Effect<void, Error> {
  return tryAsync(async () => await client.query('COMMIT'), 'Failed to commit transaction')
}

export function rollbackTransaction(client: pg.PoolClient): Effect.Effect<void, Error> {
  return tryAsync(async () => await client.query('ROLLBACK'), 'Failed to rollback transaction')
}

export function connectClient(pool: pg.Pool): Effect.Effect<pg.PoolClient, Error> {
  return tryAsync(async () => await pool.connect(), 'Failed to connect to database')
}

export function releaseClient(client: pg.PoolClient): Effect.Effect<void, never> {
  return Effect.sync(() => client.release())
}
